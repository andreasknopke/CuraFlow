import { describe, expect, it } from 'vitest';
import { SPLIT_DRAG_PREFIX, SPLIT_PANEL_PREFIX } from '../scheduleConstants';
import {
  buildDoctorChipLabelMap,
  formatChipLabel,
  getShiftDisplayMode,
  normalizeDraggableId,
  parseAvailableDoctorId,
  parseSectionTabs,
  stripPanelPrefix,
  withPanelPrefix,
} from '../scheduleFormatters';

describe('schedule formatters', () => {
  it('adds and removes panel/drag prefixes consistently', () => {
    const cellId = withPanelPrefix('cell-1', SPLIT_PANEL_PREFIX);
    const dragId = `${SPLIT_DRAG_PREFIX}available-doc-doc-42-2026-04-10`;

    expect(stripPanelPrefix(cellId)).toBe('cell-1');
    expect(normalizeDraggableId(dragId)).toBe('available-doc-doc-42-2026-04-10');
    expect(parseAvailableDoctorId(dragId)).toBe('doc-42');
  });

  it('parses only valid section tabs from persisted JSON', () => {
    expect(
      parseSectionTabs(
        JSON.stringify([
          { id: 'tab-1', sectionTitle: 'Dienste' },
          { id: '', sectionTitle: 'Invalid' },
          { foo: 'bar' },
        ]),
      ),
    ).toEqual([{ id: 'tab-1', sectionTitle: 'Dienste' }]);

    expect(parseSectionTabs('not-json')).toEqual([]);
  });

  it('normalizes chip labels and keeps generated doctor labels unique', () => {
    const labelMap = buildDoctorChipLabelMap([
      { id: 'doc-1', initials: 'AB', name: 'Anna Becker' },
      { id: 'doc-2', initials: 'AB', name: 'Armin Braun' },
    ]);

    expect(formatChipLabel('Ä')).toBe('AAA');
    expect(labelMap.get('doc-1')).toHaveLength(3);
    expect(labelMap.get('doc-2')).toHaveLength(3);
    expect(labelMap.get('doc-1')).not.toBe(labelMap.get('doc-2'));
  });

  it('switches to compact mode when space or flags require it', () => {
    const baseParams = {
      doctor: { name: 'Alexandra Musterfrau' },
      isSplitModeActive: false,
      isSectionFullWidth: true,
      isSingleShift: true,
      forceInitialsOnly: false,
      cellWidth: 1000,
      gridFontSize: 14,
      boxSize: 32,
    } as const;

    expect(getShiftDisplayMode(baseParams)).toBe('full');
    expect(getShiftDisplayMode({ ...baseParams, forceInitialsOnly: true })).toBe('compact');
    expect(getShiftDisplayMode({ ...baseParams, cellWidth: 10 })).toBe('compact');
  });
});
