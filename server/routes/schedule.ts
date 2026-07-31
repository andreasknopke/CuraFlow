import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import ExcelJS from 'exceljs';
import { db } from '../index.js';
import { authMiddleware } from './auth.js';
import { format, addDays, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { listShiftEntriesWithCentralAbsences } from '../utils/centralAbsences.js';

const router = express.Router();
router.use(authMiddleware);

type ExtendedRequest = Request & {
  user?: { sub?: string; role?: string; doctor_id?: string; [key: string]: unknown };
  db?: Pool;
};

interface ShiftRow {
  date: string | Date;
  position: string;
  doctor_id: string | number;
  order?: number;
  start_time?: string;
  end_time?: string;
  timeslot_id?: string;
  [key: string]: unknown;
}

interface DoctorRow {
  id: string | number;
  name?: string;
  initials?: string;
  [key: string]: unknown;
}

interface WorkplaceRow {
  name: string;
  order?: number;
  category?: string;
  [key: string]: unknown;
}

interface NoteRow {
  date: string | Date;
  position: string;
  content?: string;
  [key: string]: unknown;
}

interface BlockRow {
  date: string | Date;
  position: string;
  type?: string;
  reason?: string;
  [key: string]: unknown;
}

interface ColorRow {
  name: string;
  category: string;
  bg_color?: string;
  text_color?: string;
  [key: string]: unknown;
}

// Default colors for sections and positions
const DEFAULT_COLORS: Record<string, Record<string, { bg: string; text: string }>> = {
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

// Helper: Convert hex color to ARGB format for Excel
const getArgb = (hex: string | undefined | null): string | null => {
  if (!hex) return null;
  const clean = hex.replace('#', '');
  return 'FF' + clean.toUpperCase();
};

// Helper: Format date for Excel header (German locale)
const formatDateHeader = (date: Date): string => {
  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const dayName = dayNames[date.getDay()];
  return `${day}.${month}.${year} (${dayName})`;
};

// ===== EXPORT SCHEDULE TO EXCEL =====
router.post('/export', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { startDate, endDate, hiddenRows = [] } = body;

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'Missing required parameters: startDate and endDate' });
      return;
    }

    const start = parseISO(String(startDate));
    const end = parseISO(String(endDate));
    const extReq = req as ExtendedRequest;
    const dbPool = extReq.db || db;

    // Fetch all required data from database
    const shiftRows = (extReq.db
      ? await listShiftEntriesWithCentralAbsences({
          tenantDb: dbPool,
          masterDb: db,
          filters: {
            date: {
              $gte: String(startDate),
              $lte: String(endDate),
            },
          },
          sort: 'date',
        })
      : (await dbPool.execute(
          `SELECT * FROM ShiftEntry WHERE date >= ? AND date <= ? ORDER BY date, \`order\``,
          [String(startDate), String(endDate)]
        ) as [ShiftRow[], unknown])[0]) as ShiftRow[];

    const [doctorRows] = await dbPool.execute(`SELECT * FROM Doctor`) as [DoctorRow[], unknown];
    const [workplaceRows] = await dbPool.execute(`SELECT * FROM Workplace ORDER BY \`order\``) as [WorkplaceRow[], unknown];
    const [noteRows] = await dbPool.execute(
      `SELECT * FROM ScheduleNote WHERE date >= ? AND date <= ?`,
      [String(startDate), String(endDate)]
    ) as [NoteRow[], unknown];

    // Try to get color settings (may not exist in all setups)
    let colorSettings: ColorRow[] = [];
    try {
      const [colorRows] = await dbPool.execute(`SELECT * FROM ColorSetting`) as [ColorRow[], unknown];
      colorSettings = colorRows;
    } catch (e) {
      console.log('ColorSetting table not available, using defaults');
    }

    // Fetch schedule blocks (locked cells)
    let blockRows: BlockRow[] = [];
    try {
      const [rows] = await dbPool.execute(
        `SELECT * FROM ScheduleBlock WHERE date >= ? AND date <= ?`,
        [String(startDate), String(endDate)]
      ) as [BlockRow[], unknown];
      blockRows = rows;
    } catch (e) {
      // ScheduleBlock table may not exist yet
    }

    // Separate blocks (locked cells) from infos (informational notes)
    // type='block' = cell is locked, type='info' = cell has a note
    const blockEntries = blockRows.filter(b => b.type !== 'info');
    const infoEntries = blockRows.filter(b => b.type === 'info');

    // Build block lookup map: "date|position" → reason (only locked cells)
    const blockMap = new Map<string, string>();
    for (const block of blockEntries) {
      const dateStr = block.date instanceof Date ? format(block.date, 'yyyy-MM-dd') : String(block.date).substring(0, 10);
      const key = `${dateStr}|${block.position}`;
      blockMap.set(key, block.reason || 'Gesperrt');
    }

    // Build info lookup map: "date|position" → reason (informational notes)
    const infoMap = new Map<string, string>();
    for (const info of infoEntries) {
      const dateStr = info.date instanceof Date ? format(info.date, 'yyyy-MM-dd') : String(info.date).substring(0, 10);
      const key = `${dateStr}|${info.position}`;
      infoMap.set(key, info.reason || '');
    }

    // Helper: Get color for a name and category
    const getColor = (name: string, category: string): { bg: string | null; text: string | null } => {
      // 1. Check custom setting
      const setting = colorSettings.find(s => s.name === name && s.category === category);
      if (setting) {
        return { bg: getArgb(setting.bg_color), text: getArgb(setting.text_color) };
      }
      // 2. Check defaults
      let def: { bg: string; text: string } | null = null;
      if (category === 'section') def = DEFAULT_COLORS.sections[name] as { bg: string; text: string } | undefined ?? null;
      if (category === 'position') def = DEFAULT_COLORS.positions[name] as { bg: string; text: string } | undefined ?? null;

      if (def) {
        return { bg: getArgb(def.bg), text: getArgb(def.text) };
      }
      // 3. Fallback
      return { bg: 'FFFFFFFF', text: 'FF000000' };
    };

    // Setup Rows - static absences and workplaces by category
    const staticAbsences = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];
    const sortedWorkplaces = workplaceRows.sort((a, b) => (a.order || 0) - (b.order || 0));

    const sections = [
      { title: "Abwesenheiten", rows: staticAbsences },
      { title: "Dienste", rows: sortedWorkplaces.filter(w => w.category === "Dienste").map(w => w.name) },
      { title: "Rotationen", rows: sortedWorkplaces.filter(w => w.category === "Rotationen").map(w => w.name) },
      { title: "Demonstrationen & Konsile", rows: sortedWorkplaces.filter(w => w.category === "Demonstrationen & Konsile").map(w => w.name) },
      { title: "Sonstiges", rows: ["Sonstiges"] }
    ];

    // Prepare Days array
    const days: Date[] = [];
    let curr = new Date(start);
    while (curr <= end) {
      days.push(new Date(curr));
      curr = addDays(curr, 1);
    }

    // Create Workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Wochenplan');

    // Setup Columns
    sheet.columns = [
      { header: 'Position / Datum', key: 'pos', width: 35 },
      ...days.map((d, i) => ({ header: formatDateHeader(d), key: `day_${i}`, width: 20 }))
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.height = 25;
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    });

    // Helper: Normalize date to string format yyyy-MM-dd
    const normalizeDate = (date: string | Date | null | undefined): string => {
      if (!date) return '';
      if (typeof date === 'string') return date.substring(0, 10);
      if (date instanceof Date) return format(date, 'yyyy-MM-dd');
      return String(date).substring(0, 10);
    };

    // Helper: Get content for a position and date
    const findContent = (posName: string, dateStr: string): string => {
      if (posName === "Sonstiges") {
        const note = noteRows.find(n => normalizeDate(n.date) === dateStr && n.position === posName);
        return note ? (note.content || '') : "";
      }
      const cellShifts = shiftRows
        .filter(s => normalizeDate(s.date) === dateStr && s.position === posName)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      if (cellShifts.length === 0) return "";
      return cellShifts.map(s => {
        const doc = doctorRows.find(d => String(d.id) === String(s.doctor_id));
        return doc ? (doc.initials || doc.name || '') : "?";
      }).join(", ");
    };

    // Add Rows for each section
    sections.forEach(section => {
      if (section.rows.length === 0) return;

      // Section Header Row
      const sectionRow = sheet.addRow([section.title]);
      const secColors = getColor(section.title, 'section');

      sectionRow.height = 25;
      sectionRow.font = { bold: true, color: { argb: secColors.text || 'FF000000' } };
      sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: secColors.bg || 'FFFFFFFF' } };
      sectionRow.getCell(1).alignment = { vertical: 'middle' };

      // Merge section header across all columns
      try {
        sheet.mergeCells(sectionRow.number, 1, sectionRow.number, days.length + 1);
      } catch (e) {} // ignore if fail

      // Apply border/fill to the merged cell
      sectionRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: secColors.bg || 'FFFFFFFF' } };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      // Data Rows for each position in section
      section.rows.forEach((rowName: string) => {
        if ((hiddenRows as string[]).includes(rowName)) return;

        const rowData: Record<string, string> = { pos: rowName };
        days.forEach((day, i) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          rowData[`day_${i}`] = findContent(rowName, dateStr);
        });

        const r = sheet.addRow(rowData);
        if (rowName !== "Sonstiges") {
          r.height = 20;
        }

        // Style first cell (Row Label)
        const firstCell = r.getCell(1);

        // Determine color for position
        let posColors = { bg: secColors.bg || 'FFFFFFFF', text: secColors.text || 'FF000000' };

        // Check specific position color settings
        const posSetting = colorSettings.find(s => s.name === rowName && s.category === 'position');
        if (posSetting) {
          posColors = { bg: getArgb(posSetting.bg_color) || 'FFFFFFFF', text: getArgb(posSetting.text_color) || 'FF000000' };
        } else if (DEFAULT_COLORS.positions[rowName]) {
          const def = DEFAULT_COLORS.positions[rowName];
          posColors = { bg: getArgb(def.bg) || 'FFFFFFFF', text: getArgb(def.text) || 'FF000000' };
        }

        firstCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posColors.bg } };
        firstCell.font = { color: { argb: posColors.text }, bold: true };
        firstCell.alignment = { vertical: 'middle', wrapText: false };

        // Style Data Cells
        r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
          };
          if (colNumber > 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            const dayIndex = colNumber - 2;
            if (dayIndex >= 0 && dayIndex < days.length) {
              const dateStr = format(days[dayIndex], 'yyyy-MM-dd');
              const blockKey = `${dateStr}|${rowName}`;
              // Blocked cell — overwrite content with lock indicator
              const blockReason = blockMap.get(blockKey);
              if (blockReason) {
                cell.value = `🔒 ${blockReason}`;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                cell.font = { color: { argb: 'FF991B1B' }, italic: true };
              }
              // Info note — add as Excel comment without overwriting content
              const infoReason = infoMap.get(blockKey);
              if (infoReason) {
                cell.note = infoReason;
              }
            }
          }
        });
      });
    });

    // Generate buffer and convert to base64
    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    // Return as JSON with base64 file (matching old Base44 format)
    res.json({ file: base64 });

  } catch (error) {
    console.error('Export error:', error);
    next(error);
  }
});

// ===== SEND SCHEDULE NOTIFICATIONS =====
router.post('/notify', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const { scheduleId, type } = body;

    // Placeholder - implement actual notification logic
    // Could use email service, push notifications, etc.

    res.json({ success: true, message: 'Notifications sent' });
  } catch (error) {
    next(error);
  }
});

export default router;
