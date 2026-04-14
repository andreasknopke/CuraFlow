import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSchedulePreferences } from '../useSchedulePreferences';

describe('useSchedulePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('initializes from the user profile and persists changed preferences', async () => {
    const updateMe = vi.fn().mockResolvedValue(undefined);
    const user = {
      schedule_show_sidebar: true,
      schedule_hidden_rows: ['Dienst A'],
      collapsed_sections: ['Abwesenheiten'],
      highlight_my_name: true,
      schedule_initials_only: false,
      schedule_sort_doctors_alphabetically: false,
    };

    const { result } = renderHook(() => useSchedulePreferences(user, updateMe));

    expect(result.current.showSidebar).toBe(true);
    expect(result.current.hiddenRows).toEqual(['Dienst A']);
    expect(result.current.collapsedSections).toEqual(['Abwesenheiten']);

    act(() => {
      result.current.setShowSidebar(false);
      result.current.setHiddenRows(['Dienst B']);
      result.current.setCollapsedSections(['Rotationen']);
      result.current.setHighlightMyName(false);
      result.current.setShowInitialsOnly(true);
      result.current.setSortDoctorsAlphabetically(true);
      result.current.setGridFontSize(18);
    });

    await waitFor(() => {
      expect(updateMe).toHaveBeenCalledWith({ schedule_show_sidebar: false });
      expect(updateMe).toHaveBeenCalledWith({ schedule_hidden_rows: ['Dienst B'] });
      expect(updateMe).toHaveBeenCalledWith({ collapsed_sections: ['Rotationen'] });
      expect(updateMe).toHaveBeenCalledWith({ highlight_my_name: false });
      expect(updateMe).toHaveBeenCalledWith({ schedule_initials_only: true });
      expect(updateMe).toHaveBeenCalledWith({ schedule_sort_doctors_alphabetically: true });
    });

    expect(JSON.parse(localStorage.getItem('radioplan_showSidebar') || 'null')).toBe(false);
    expect(JSON.parse(localStorage.getItem('radioplan_hiddenRows') || 'null')).toEqual([
      'Dienst B',
    ]);
    expect(JSON.parse(localStorage.getItem('radioplan_collapsedSections') || 'null')).toEqual([
      'Rotationen',
    ]);
    expect(JSON.parse(localStorage.getItem('radioplan_highlightMyName') || 'null')).toBe(false);
    expect(JSON.parse(localStorage.getItem('radioplan_showInitialsOnly') || 'null')).toBe(true);
    expect(JSON.parse(localStorage.getItem('radioplan_sortDoctorsAlphabetically') || 'null')).toBe(
      true,
    );
    expect(JSON.parse(localStorage.getItem('radioplan_gridFontSize') || 'null')).toBe(18);
  });

  it('falls back to local storage, keeps local-only prefs local, and sorts doctors when enabled', async () => {
    localStorage.setItem('radioplan_showSidebar', JSON.stringify(false));
    localStorage.setItem('radioplan_sortDoctorsAlphabetically', JSON.stringify(true));
    localStorage.setItem('radioplan_collapsedTimeslotGroups', JSON.stringify(['CT']));

    const updateMe = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSchedulePreferences(null, updateMe));

    expect(result.current.showSidebar).toBe(false);
    expect(result.current.collapsedTimeslotGroups).toEqual(['CT']);

    expect(
      result.current
        .sortDoctorsForDisplay([
          { name: 'Zeta', initials: 'ZZ' },
          { name: 'Ärztin', initials: 'AE' },
          { name: 'Alpha', initials: 'AA' },
        ])
        .map((doctor) => doctor.name),
    ).toEqual(['Alpha', 'Ärztin', 'Zeta']);

    act(() => {
      result.current.toggleTimeslotGroup('MR');
    });

    await waitFor(() => {
      expect(result.current.collapsedTimeslotGroups).toEqual(['CT', 'MR']);
    });

    expect(JSON.parse(localStorage.getItem('radioplan_collapsedTimeslotGroups') || 'null')).toEqual(
      ['CT', 'MR'],
    );
    expect(updateMe).not.toHaveBeenCalled();
  });
});
