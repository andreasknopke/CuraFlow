export const ALWAYS_VISIBLE_ROWS_KEY = 'schedule_always_visible_rows';

interface VisibleRowEntry {
    rowName: string;
    targetSectionTitle: string;
}

interface SectionRow {
    name: string;
    displayName?: string;
    timeslotId?: string | null;
}

interface ScheduleSection {
    title: string;
    rows: SectionRow[];
}

const normalizeEntry = (entry: unknown): VisibleRowEntry | null => {
    const obj = entry as Record<string, unknown> | null;
    const rowName = typeof obj?.rowName === 'string' ? obj.rowName.trim() : '';
    const targetSectionTitle = typeof obj?.targetSectionTitle === 'string' ? obj.targetSectionTitle.trim() : '';

    if (!rowName || !targetSectionTitle) {
        return null;
    }

    return { rowName, targetSectionTitle };
};

export function parseAlwaysVisibleRows(rawValue: unknown): VisibleRowEntry[] {
    if (!rawValue) return [];

    try {
        const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        if (!Array.isArray(parsed)) return [];

        const seen = new Set<string>();
        const entries: VisibleRowEntry[] = [];
        for (const item of parsed) {
            const entry = normalizeEntry(item);
            if (!entry) continue;

            const key = `${entry.rowName}__${entry.targetSectionTitle}`;
            if (seen.has(key)) continue;

            seen.add(key);
            entries.push(entry);
        }

        return entries;
    } catch {
        return [];
    }
}

export function applyAlwaysVisibleRowsToSection(
    allSections: ScheduleSection[] = [],
    targetSectionTitle?: string,
    alwaysVisibleRows: VisibleRowEntry[] = [],
): ScheduleSection[] {
    if (!targetSectionTitle) return allSections;

    const targetRows = alwaysVisibleRows.filter((entry) => entry.targetSectionTitle === targetSectionTitle);
    if (targetRows.length === 0) return allSections;

    const targetRowNames = new Set(targetRows.map((entry) => entry.rowName));

    return allSections.map((section) => {
        if (section.title !== targetSectionTitle) return section;

        const existingRowKeys = new Set<string>(
            section.rows.map((row) => {
                const rowObj = typeof row === 'string' ? { name: row, timeslotId: null } : row;
                return `${rowObj.name}__${rowObj.timeslotId || ''}`;
            })
        );

        const additionalRows: SectionRow[] = [];
        for (const sourceSection of allSections) {
            if (sourceSection.title === targetSectionTitle) continue;

            for (const row of sourceSection.rows) {
                const rowObj = typeof row === 'string' ? { name: row, displayName: row, timeslotId: null } : row;
                if (!targetRowNames.has(rowObj.name)) continue;

                const key = `${rowObj.name}__${rowObj.timeslotId || ''}`;
                if (existingRowKeys.has(key)) continue;

                existingRowKeys.add(key);
                additionalRows.push({
                    ...rowObj,
                    isAlwaysVisibleRow: true,
                    sourceSectionTitle: sourceSection.title,
                } as SectionRow & { isAlwaysVisibleRow: boolean; sourceSectionTitle: string });
            }
        }

        if (additionalRows.length === 0) return section;

        return {
            ...section,
            rows: [...section.rows, ...additionalRows],
        };
    });
}

export function applyAlwaysVisibleRowsToSections(
    allSections: ScheduleSection[] = [],
    alwaysVisibleRows: VisibleRowEntry[] = [],
): ScheduleSection[] {
    const targetSectionTitles = Array.from(new Set(alwaysVisibleRows.map((entry) => entry.targetSectionTitle).filter(Boolean)));
    return targetSectionTitles.reduce(
        (sections, targetSectionTitle) => applyAlwaysVisibleRowsToSection(sections, targetSectionTitle, alwaysVisibleRows),
        allSections
    );
}

export function getSectionWithAlwaysVisibleRows(
    allSections: ScheduleSection[] = [],
    targetSectionTitle?: string,
    alwaysVisibleRows: VisibleRowEntry[] = [],
): ScheduleSection | undefined {
    return applyAlwaysVisibleRowsToSection(allSections, targetSectionTitle, alwaysVisibleRows)
        .find((section) => section.title === targetSectionTitle);
}
