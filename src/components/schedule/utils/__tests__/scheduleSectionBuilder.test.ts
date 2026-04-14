import { describe, expect, it } from 'vitest';
import { buildScheduleSections } from '../scheduleSectionBuilder';

describe('buildScheduleSections', () => {
  it('builds ordered sections with custom categories and orphaned archive rows', () => {
    const sections = buildScheduleSections({
      workplaces: [
        { id: 'wp-1', name: 'Dienst A', category: 'Dienste', order: 2 },
        { id: 'wp-2', name: 'Rotation A', category: 'Rotationen', order: 1 },
        { id: 'wp-3', name: 'Custom Lab', category: 'Spezial', order: 1 },
      ],
      allShifts: [{ position: 'Dienst A' }, { position: 'Archivdienst' }],
      getSectionOrder: () => ['Anwesenheiten', 'Dienste', 'Rotationen', 'Sonstiges'],
      systemSettings: [
        {
          key: 'workplace_categories',
          value: JSON.stringify([{ name: 'Spezial', allows_multiple: true }]),
        },
      ],
    });

    expect(sections.map((section) => section.title)).toEqual([
      'Anwesenheiten',
      'Dienste',
      'Rotationen',
      'Abwesenheiten',
      'Demonstrationen & Konsile',
      'Spezial',
      'Sonstiges',
      'Archiv / Unbekannt',
    ]);

    expect(sections.find((section) => section.title === 'Spezial')?.rows).toEqual([
      expect.objectContaining({ name: 'Custom Lab', displayName: 'Custom Lab' }),
    ]);
    expect(sections.at(-1)?.rows).toEqual([
      expect.objectContaining({ name: 'Archivdienst', displayName: 'Archivdienst' }),
    ]);
  });

  it('creates timeslot group rows for workplaces with multiple slots', () => {
    const sections = buildScheduleSections({
      workplaces: [{ id: 'wp-1', name: 'CT', category: 'Dienste', timeslots_enabled: true }],
      workplaceTimeslots: [
        { id: 'ts-1', workplace_id: 'wp-1', label: 'Früh', order: 2, start_time: '08:00' },
        { id: 'ts-2', workplace_id: 'wp-1', label: 'Spät', order: 3, end_time: '16:00' },
      ],
      getSectionOrder: () => ['Dienste'],
    });

    expect(sections[0].rows).toEqual([
      expect.objectContaining({
        name: 'CT',
        isTimeslotGroupHeader: true,
        allTimeslotIds: ['ts-1', 'ts-2'],
      }),
      expect.objectContaining({
        displayName: 'CT (Nicht zugewiesen)',
        timeslotId: '__unassigned__',
      }),
      expect.objectContaining({ displayName: 'CT (Früh)', timeslotId: 'ts-1', startTime: '08:00' }),
      expect.objectContaining({ displayName: 'CT (Spät)', timeslotId: 'ts-2', endTime: '16:00' }),
    ]);
  });
});
