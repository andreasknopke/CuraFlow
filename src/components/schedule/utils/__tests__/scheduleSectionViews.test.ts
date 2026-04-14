import { describe, expect, it } from 'vitest';
import {
  getAvailableSectionTabs,
  getSplitSectionsForTab,
  getVisibleSectionsForTab,
} from '../scheduleSectionViews';

const sections = [
  { title: 'Anwesenheiten' },
  { title: 'Dienste' },
  { title: 'Rotationen' },
  { title: 'Sonstiges' },
];

const tabs = [
  { id: 'dienste-tab', sectionTitle: 'Dienste' },
  { id: 'unknown-tab', sectionTitle: 'Unbekannt' },
  { id: 'anwesenheiten-tab', sectionTitle: 'Anwesenheiten' },
];

describe('scheduleSectionViews', () => {
  it('keeps only tabs that point to existing non-pinned sections', () => {
    expect(getAvailableSectionTabs(tabs, sections)).toEqual([
      { id: 'dienste-tab', sectionTitle: 'Dienste' },
    ]);
  });

  it('returns main view sections without tab-assigned sections except the pinned one', () => {
    expect(
      getVisibleSectionsForTab('main', [{ id: 'dienste-tab', sectionTitle: 'Dienste' }], sections),
    ).toEqual([{ title: 'Anwesenheiten' }, { title: 'Rotationen' }, { title: 'Sonstiges' }]);
  });

  it('returns the active tab section together with the pinned section', () => {
    expect(
      getVisibleSectionsForTab(
        'dienste-tab',
        [{ id: 'dienste-tab', sectionTitle: 'Dienste' }],
        sections,
      ),
    ).toEqual([{ title: 'Dienste' }, { title: 'Anwesenheiten' }]);
  });

  it('returns split view sections for the selected tab', () => {
    expect(
      getSplitSectionsForTab(
        true,
        'dienste-tab',
        [{ id: 'dienste-tab', sectionTitle: 'Dienste' }],
        sections,
      ),
    ).toEqual([{ title: 'Dienste' }, { title: 'Anwesenheiten' }]);
  });

  it('returns an empty list when split view is disabled or the tab is invalid', () => {
    expect(getSplitSectionsForTab(false, 'dienste-tab', tabs, sections)).toEqual([]);
    expect(getSplitSectionsForTab(true, 'missing-tab', tabs, sections)).toEqual([]);
  });
});
