import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import ExcelJS from 'npm:exceljs@4.4.0';
import { format, addDays } from 'npm:date-fns@2.30.0';
import { Buffer } from 'node:buffer';

const DEFAULT_COLORS = {
    sections: {
        "Abwesenheiten": { bg: "#e2e8f0", text: "#1e293b" },
        "Dienste": { bg: "#dbeafe", text: "#1e3a8a" },
        "Rotationen": { bg: "#d1fae5", text: "#064e3b" },
        "Demonstrationen & Konsile": { bg: "#fef3c7", text: "#78350f" },
        "Sonstiges": { bg: "#f3e8ff", text: "#581c87" },
    },
    positions: {
        "Frei": { bg: "#64748b", text: "#ffffff" },
        "Krank": { bg: "#ef4444", text: "#ffffff" },
        "Urlaub": { bg: "#22c55e", text: "#ffffff" },
        "Dienstreise": { bg: "#3b82f6", text: "#ffffff" },
        "Nicht verfügbar": { bg: "#f97316", text: "#ffffff" },
    }
};

const getArgb = (hex) => {
    if (!hex) return null;
    const clean = hex.replace('#', '');
    return 'FF' + clean;
};

// Helper to query data from either MySQL (via dbProxy) or Base44 depending on db_mode
const queryData = async (base44, entity, action, options = {}) => {
    // First check db_mode from SystemSetting (always in Base44)
    let dbMode = 'internal';
    try {
        const settings = await base44.entities.SystemSetting.list();
        const modeSetting = settings.find(s => s.key === 'db_mode');
        if (modeSetting) dbMode = modeSetting.value;
    } catch (e) {
        console.warn("Could not fetch db_mode, defaulting to internal", e.message);
    }

    // For SystemSetting, ColorSetting - always use Base44 (config data)
    const alwaysBase44 = ['SystemSetting', 'ColorSetting'];
    if (alwaysBase44.includes(entity)) {
        dbMode = 'internal';
    }

    if (dbMode === 'mysql') {
        // Use dbProxy function
        const res = await base44.functions.invoke('dbProxy', {
            action,
            entity,
            ...options
        });
        return res.data || [];
    } else {
        // Use Base44 SDK directly
        if (action === 'list') {
            return base44.entities[entity].list(options.sort, options.limit);
        } else if (action === 'filter') {
            return base44.entities[entity].filter(options.query, options.sort, options.limit);
        }
    }
    return [];
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { startDate, endDate, hiddenRows = [] } = await req.json();
        const start = new Date(startDate);
        const end = new Date(endDate);

        const [weekShifts, doctors, workplaces, weekNotes, colorSettings] = await Promise.all([
            queryData(base44, 'ShiftEntry', 'filter', {
                query: { date: { $gte: startDate, $lte: endDate } },
                limit: 5000
            }),
            queryData(base44, 'Doctor', 'list', { limit: 500 }),
            queryData(base44, 'Workplace', 'list', { limit: 500 }),
            queryData(base44, 'ScheduleNote', 'filter', {
                query: { date: { $gte: startDate, $lte: endDate } },
                limit: 1000
            }),
            queryData(base44, 'ColorSetting', 'list', { limit: 500 })
        ]);

        // Helpers for colors
        const getColor = (name, category) => {
            // 1. Check custom setting
            const setting = colorSettings.find(s => s.name === name && s.category === category);
            if (setting) {
                return { bg: getArgb(setting.bg_color), text: getArgb(setting.text_color) };
            }
            // 2. Check defaults
            let def = null;
            if (category === 'section') def = DEFAULT_COLORS.sections[name];
            if (category === 'position') def = DEFAULT_COLORS.positions[name];
            
            if (def) {
                return { bg: getArgb(def.bg), text: getArgb(def.text) };
            }
            // 3. Fallback
            return { bg: 'FFFFFFFF', text: 'FF000000' };
        };

        // Setup Rows
        const staticAbsences = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
        const sortedWorkplaces = workplaces.sort((a, b) => (a.order || 0) - (b.order || 0));

        const sections = [
            { title: "Abwesenheiten", rows: staticAbsences },
            { title: "Dienste", rows: sortedWorkplaces.filter(w => w.category === "Dienste").map(w => w.name) },
            { title: "Rotationen", rows: sortedWorkplaces.filter(w => w.category === "Rotationen").map(w => w.name) },
            { title: "Demonstrationen & Konsile", rows: sortedWorkplaces.filter(w => w.category === "Demonstrationen & Konsile").map(w => w.name) },
            { title: "Sonstiges", rows: ["Sonstiges"] }
        ];

        // Prepare Days
        const days = [];
        let curr = new Date(start);
        while (curr <= end) {
            days.push(new Date(curr));
            curr = addDays(curr, 1);
        }

        // Create Workbook
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Wochenplan');

        // Columns
        sheet.columns = [
            { header: 'Position / Datum', key: 'pos', width: 35 },
            ...days.map((d, i) => ({ header: format(d, 'dd.MM.yyyy (EEE)'), key: `day_${i}`, width: 20 }))
        ];

        // Style Header Row
        const headerRow = sheet.getRow(1);
        headerRow.height = 25;
        headerRow.font = { bold: true };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            cell.border = {
                top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
            };
        });

        // Helper: Get content
        const findContent = (posName, dateStr) => {
            if (posName === "Sonstiges") {
                const note = weekNotes.find(n => n.date === dateStr && n.position === posName);
                return note ? note.content : "";
            }
            const cellShifts = weekShifts
                .filter(s => s.date === dateStr && s.position === posName)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            
            if (cellShifts.length === 0) return "";
            return cellShifts.map(s => {
                const doc = doctors.find(d => d.id === s.doctor_id);
                return doc ? (doc.initials || doc.name) : "?";
            }).join(", ");
        };

        // Add Rows
        sections.forEach(section => {
            if (section.rows.length === 0) return;

            // Section Header Row
            const sectionRow = sheet.addRow([section.title]);
            const secColors = getColor(section.title, 'section');
            
            sectionRow.height = 25;
            sectionRow.font = { bold: true, color: { argb: secColors.text } };
            sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: secColors.bg } };
            sectionRow.getCell(1).alignment = { vertical: 'middle' };
            // Merge section header across all columns
            try {
                sheet.mergeCells(sectionRow.number, 1, sectionRow.number, days.length + 1);
            } catch (e) {} // ignore if fail
            
            // Apply border/fill to the merged cell
            sectionRow.eachCell(cell => {
                 cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: secColors.bg } };
                 cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
            });

            // Data Rows
            section.rows.forEach(rowName => {
                if (hiddenRows.includes(rowName)) return;

                const rowData = { pos: rowName };
                days.forEach((day, i) => {
                    rowData[`day_${i}`] = findContent(rowName, format(day, 'yyyy-MM-dd'));
                });
                
                const r = sheet.addRow(rowData);
                if (rowName !== "Sonstiges") {
                    r.height = 20;
                }

                // Style first cell (Row Label)
                const firstCell = r.getCell(1);
                
                // Determine color for position
                // Try position specific color first, else section color (lighter)
                // Logic matching frontend: Position color if set, else section color with opacity.
                // Here we just use section color as base if no position color, maybe slightly lighter manually or just same.
                
                // For Excel, let's use:
                // 1. Specific Position Color
                // 2. Section Color
                let posColors = { bg: secColors.bg, text: secColors.text };
                
                // Check specific position color settings
                const posSetting = colorSettings.find(s => s.name === rowName && s.category === 'position');
                if (posSetting) {
                    posColors = { bg: getArgb(posSetting.bg_color), text: getArgb(posSetting.text_color) };
                } else if (DEFAULT_COLORS.positions[rowName]) {
                     const def = DEFAULT_COLORS.positions[rowName];
                     posColors = { bg: getArgb(def.bg), text: getArgb(def.text) };
                }

                firstCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posColors.bg } };
                firstCell.font = { color: { argb: posColors.text }, bold: true };
                firstCell.alignment = { vertical: 'middle', wrapText: false };

                // Style Data Cells
                r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    cell.border = {
                        top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
                    };
                    if (colNumber > 1) {
                         cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    }
                });
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'info',
                source: 'ExcelExport',
                message: 'Schedule exported successfully',
                details: JSON.stringify({ startDate, endDate, user: user.email })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ file: base64 });

    } catch (error) {
        try {
            await base44.asServiceRole.entities.SystemLog.create({
                level: 'error',
                source: 'ExcelExport',
                message: 'Export failed',
                details: JSON.stringify({ error: error.message })
            });
        } catch (e) { console.error("Log failed", e); }

        return Response.json({ error: error.message }, { status: 500 });
    }
});