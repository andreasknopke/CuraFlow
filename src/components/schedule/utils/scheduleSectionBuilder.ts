import { SECTION_CONFIG, STATIC_SECTIONS } from './scheduleConstants';
import { getWorkplaceCategoriesFromSettings } from '@/utils/workplaceCategoryUtils';

interface WorkplaceLike {
  id: string;
  name: string;
  category?: string;
  order?: number | null;
  timeslots_enabled?: boolean;
}

interface WorkplaceTimeslotLike {
  id: string;
  workplace_id: string;
  label: string;
  order?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

interface ShiftLike {
  position: string;
}

interface SystemSettingLike {
  key: string;
  value?: string;
}

interface SectionRow {
  name: string;
  displayName: string;
  timeslotId: string | null;
  isTimeslotRow: boolean;
  [key: string]: unknown;
}

interface SectionLike {
  title: string;
  headerColor: string;
  rowColor: string;
  rows: SectionRow[];
}

interface BuildScheduleSectionsOptions {
  workplaces?: WorkplaceLike[];
  workplaceTimeslots?: WorkplaceTimeslotLike[];
  allShifts?: ShiftLike[];
  previewShifts?: ShiftLike[] | null;
  getSectionOrder: () => string[];
  systemSettings?: SystemSettingLike[];
}

const toStaticRows = (rows: string[]): SectionRow[] =>
  rows.map((name) => ({
    name,
    displayName: name,
    timeslotId: null,
    isTimeslotRow: false,
  }));

const buildCategoryRows = (
  categoryName: string,
  workplaces: WorkplaceLike[],
  workplaceTimeslots: WorkplaceTimeslotLike[],
): SectionRow[] => {
  const categoryWorkplaces = workplaces
    .filter((workplace) => workplace.category === categoryName)
    .sort((left, right) => (left.order || 0) - (right.order || 0));

  const rows: SectionRow[] = [];

  for (const workplace of categoryWorkplaces) {
    if (!workplace.timeslots_enabled) {
      rows.push({
        name: workplace.name,
        displayName: workplace.name,
        timeslotId: null,
        isTimeslotRow: false,
        isTimeslotGroupHeader: false,
      });
      continue;
    }

    const timeslots = workplaceTimeslots
      .filter((timeslot) => timeslot.workplace_id === workplace.id)
      .sort((left, right) => (left.order || 0) - (right.order || 0));

    if (timeslots.length === 1) {
      rows.push({
        name: workplace.name,
        displayName: workplace.name,
        timeslotId: null,
        isTimeslotRow: false,
        isTimeslotGroupHeader: false,
        singleTimeslotId: timeslots[0].id,
        singleTimeslotLabel: timeslots[0].label,
      });
      continue;
    }

    if (timeslots.length > 1) {
      rows.push({
        name: workplace.name,
        displayName: workplace.name,
        timeslotId: null,
        timeslotLabel: null,
        isTimeslotRow: false,
        isTimeslotGroupHeader: true,
        timeslotCount: timeslots.length,
        allTimeslotIds: timeslots.map((timeslot) => timeslot.id),
        workplaceId: workplace.id,
      });

      rows.push({
        name: workplace.name,
        displayName: `${workplace.name} (Nicht zugewiesen)`,
        timeslotId: '__unassigned__',
        timeslotLabel: 'Nicht zugewiesen',
        isTimeslotRow: true,
        isTimeslotGroupHeader: false,
        isUnassignedRow: true,
        parentWorkplace: workplace.name,
      });

      for (const timeslot of timeslots) {
        rows.push({
          name: workplace.name,
          displayName: `${workplace.name} (${timeslot.label})`,
          timeslotId: timeslot.id,
          timeslotLabel: timeslot.label,
          isTimeslotRow: true,
          isTimeslotGroupHeader: false,
          startTime: timeslot.start_time,
          endTime: timeslot.end_time,
          parentWorkplace: workplace.name,
        });
      }
      continue;
    }

    rows.push({
      name: workplace.name,
      displayName: workplace.name,
      timeslotId: null,
      isTimeslotRow: false,
      isTimeslotGroupHeader: false,
    });
  }

  return rows;
};

export function buildScheduleSections({
  workplaces = [],
  workplaceTimeslots = [],
  allShifts = [],
  previewShifts = null,
  getSectionOrder,
  systemSettings = [],
}: BuildScheduleSectionsOptions): SectionLike[] {
  const customCategories = getWorkplaceCategoriesFromSettings(systemSettings);
  const customCategoryNames = customCategories.map((category) => category.name);

  const dynamicRows: Record<string, SectionRow[]> = {
    Dienste: buildCategoryRows('Dienste', workplaces, workplaceTimeslots),
    Rotationen: buildCategoryRows('Rotationen', workplaces, workplaceTimeslots),
    'Demonstrationen & Konsile': buildCategoryRows(
      'Demonstrationen & Konsile',
      workplaces,
      workplaceTimeslots,
    ),
  };

  for (const categoryName of customCategoryNames) {
    dynamicRows[categoryName] = buildCategoryRows(categoryName, workplaces, workplaceTimeslots);
  }

  const allKnownPositions = new Set([
    ...(STATIC_SECTIONS['Anwesenheiten'].rows || []),
    ...(STATIC_SECTIONS['Abwesenheiten'].rows || []),
    ...dynamicRows['Dienste'].map((row) => row.name),
    ...dynamicRows['Rotationen'].map((row) => row.name),
    ...dynamicRows['Demonstrationen & Konsile'].map((row) => row.name),
    ...customCategoryNames.flatMap((categoryName) =>
      (dynamicRows[categoryName] || []).map((row) => row.name),
    ),
    ...(STATIC_SECTIONS['Sonstiges'].rows || []),
  ]);

  const currentViewShifts = previewShifts ? [...allShifts, ...previewShifts] : allShifts;
  const orphanedPositions = Array.from(
    new Set(
      currentViewShifts
        .map((shift) => shift.position)
        .filter((position) => !allKnownPositions.has(position)),
    ),
  ).sort();

  const defaultSections: SectionLike[] = [
    {
      title: 'Abwesenheiten',
      ...STATIC_SECTIONS['Abwesenheiten'],
      rows: toStaticRows(STATIC_SECTIONS['Abwesenheiten'].rows || []),
    },
    {
      title: 'Dienste',
      ...STATIC_SECTIONS['Dienste'],
      rows: dynamicRows['Dienste'],
    },
    {
      title: 'Rotationen',
      ...SECTION_CONFIG['Rotationen'],
      rows: dynamicRows['Rotationen'],
    },
    {
      title: 'Anwesenheiten',
      ...STATIC_SECTIONS['Anwesenheiten'],
      rows: toStaticRows(STATIC_SECTIONS['Anwesenheiten'].rows || []),
    },
    {
      title: 'Demonstrationen & Konsile',
      ...SECTION_CONFIG['Demonstrationen & Konsile'],
      rows: dynamicRows['Demonstrationen & Konsile'],
    },
    ...customCategoryNames.map((categoryName) => ({
      title: categoryName,
      headerColor: 'bg-indigo-100 text-indigo-900',
      rowColor: 'bg-indigo-50/30',
      rows: dynamicRows[categoryName] || [],
    })),
    {
      title: 'Sonstiges',
      ...STATIC_SECTIONS['Sonstiges'],
      rows: toStaticRows(STATIC_SECTIONS['Sonstiges'].rows || []),
    },
  ];

  const orderedTitles = getSectionOrder();
  const orderedSections = orderedTitles
    .map((title) => defaultSections.find((section) => section.title === title))
    .filter((section): section is SectionLike => Boolean(section));

  for (const section of defaultSections) {
    if (!orderedSections.find((existing) => existing.title === section.title)) {
      const sonstigesIndex = orderedSections.findIndex(
        (existing) => existing.title === 'Sonstiges',
      );
      if (sonstigesIndex >= 0) {
        orderedSections.splice(sonstigesIndex, 0, section);
      } else {
        orderedSections.push(section);
      }
    }
  }

  if (orphanedPositions.length > 0) {
    orderedSections.push({
      title: 'Archiv / Unbekannt',
      headerColor: 'bg-red-100 text-red-900',
      rowColor: 'bg-red-50/30',
      rows: toStaticRows(orphanedPositions),
    });
  }

  return orderedSections;
}
