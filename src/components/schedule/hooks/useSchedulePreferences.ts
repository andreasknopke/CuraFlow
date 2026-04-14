import { useState, useEffect, useCallback } from 'react';

interface UserPrefs {
  schedule_show_sidebar?: boolean;
  schedule_hidden_rows?: string[];
  collapsed_sections?: string[];
  highlight_my_name?: boolean;
  schedule_initials_only?: boolean;
  schedule_sort_doctors_alphabetically?: boolean;
  [key: string]: unknown;
}

interface SchedulePreferences {
  showSidebar: boolean;
  setShowSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  hiddenRows: string[];
  setHiddenRows: React.Dispatch<React.SetStateAction<string[]>>;
  collapsedSections: string[];
  setCollapsedSections: React.Dispatch<React.SetStateAction<string[]>>;
  highlightMyName: boolean;
  setHighlightMyName: React.Dispatch<React.SetStateAction<boolean>>;
  showInitialsOnly: boolean;
  setShowInitialsOnly: React.Dispatch<React.SetStateAction<boolean>>;
  sortDoctorsAlphabetically: boolean;
  setSortDoctorsAlphabetically: React.Dispatch<React.SetStateAction<boolean>>;
  gridFontSize: number;
  setGridFontSize: React.Dispatch<React.SetStateAction<number>>;
  collapsedTimeslotGroups: string[];
  setCollapsedTimeslotGroups: React.Dispatch<React.SetStateAction<string[]>>;
  toggleTimeslotGroup: (workplaceName: string) => void;
  sortDoctorsForDisplay: <T extends { name?: string; initials?: string }>(list: T[]) => T[];
}

function loadFromLocalStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

export function useSchedulePreferences(
  user: UserPrefs | null | undefined,
  updateMe: (patch: Partial<UserPrefs>) => Promise<unknown>,
): SchedulePreferences {
  // --- Sidebar ---
  const [showSidebar, setShowSidebar] = useState(() => {
    if (user?.schedule_show_sidebar !== undefined) return user.schedule_show_sidebar;
    return loadFromLocalStorage('radioplan_showSidebar', true);
  });

  // --- Hidden rows ---
  const [hiddenRows, setHiddenRows] = useState<string[]>(() => {
    if (user?.schedule_hidden_rows && Array.isArray(user.schedule_hidden_rows))
      return user.schedule_hidden_rows;
    return loadFromLocalStorage<string[]>('radioplan_hiddenRows', []);
  });

  // --- Collapsed sections ---
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => {
    if (user?.collapsed_sections) return user.collapsed_sections;
    return loadFromLocalStorage<string[]>('radioplan_collapsedSections', []);
  });

  // --- Highlight my name ---
  const [highlightMyName, setHighlightMyName] = useState(() => {
    if (user?.highlight_my_name !== undefined) return user.highlight_my_name;
    return loadFromLocalStorage('radioplan_highlightMyName', true);
  });

  // --- Initials only ---
  const [showInitialsOnly, setShowInitialsOnly] = useState(() => {
    if (user?.schedule_initials_only !== undefined) return user.schedule_initials_only;
    return loadFromLocalStorage('radioplan_showInitialsOnly', false);
  });

  // --- Sort doctors alphabetically ---
  const [sortDoctorsAlphabetically, setSortDoctorsAlphabetically] = useState(() => {
    if (user?.schedule_sort_doctors_alphabetically !== undefined)
      return user.schedule_sort_doctors_alphabetically;
    return loadFromLocalStorage('radioplan_sortDoctorsAlphabetically', false);
  });

  // --- Grid font size (local only, no backend sync) ---
  const [gridFontSize, setGridFontSize] = useState(() =>
    loadFromLocalStorage('radioplan_gridFontSize', 14),
  );

  // --- Collapsed timeslot groups (local only) ---
  const [collapsedTimeslotGroups, setCollapsedTimeslotGroups] = useState<string[]>(() =>
    loadFromLocalStorage<string[]>('radioplan_collapsedTimeslotGroups', []),
  );

  // ====== Sync FROM user profile when it loads/updates ======
  useEffect(() => {
    if (user?.collapsed_sections && Array.isArray(user.collapsed_sections)) {
      const userSections = user.collapsed_sections;
      setCollapsedSections((prev) => {
        if (JSON.stringify(prev) !== JSON.stringify(userSections)) {
          return userSections;
        }
        return prev;
      });
    }
    if (user?.highlight_my_name !== undefined) {
      setHighlightMyName(user.highlight_my_name);
    }
    if (user?.schedule_initials_only !== undefined) {
      setShowInitialsOnly(user.schedule_initials_only);
    }
    if (user?.schedule_sort_doctors_alphabetically !== undefined) {
      setSortDoctorsAlphabetically(user.schedule_sort_doctors_alphabetically);
    }
    if (user?.schedule_show_sidebar !== undefined) {
      setShowSidebar(user.schedule_show_sidebar);
    }
    if (user?.schedule_hidden_rows && Array.isArray(user.schedule_hidden_rows)) {
      const userHiddenRows = user.schedule_hidden_rows;
      setHiddenRows((prev) => {
        if (JSON.stringify(prev) !== JSON.stringify(userHiddenRows)) {
          return userHiddenRows;
        }
        return prev;
      });
    }
  }, [user]);

  // ====== Persist TO localStorage + backend ======
  useEffect(() => {
    localStorage.setItem('radioplan_showSidebar', JSON.stringify(showSidebar));
    if (user && user.schedule_show_sidebar !== showSidebar) {
      updateMe({ schedule_show_sidebar: showSidebar }).catch((e) =>
        console.error('Pref save failed', e),
      );
    }
  }, [showSidebar, updateMe, user]);

  useEffect(() => {
    localStorage.setItem('radioplan_hiddenRows', JSON.stringify(hiddenRows));
    if (user && JSON.stringify(user.schedule_hidden_rows) !== JSON.stringify(hiddenRows)) {
      updateMe({ schedule_hidden_rows: hiddenRows }).catch((e) =>
        console.error('Pref save failed', e),
      );
    }
  }, [hiddenRows, updateMe, user]);

  useEffect(() => {
    localStorage.setItem('radioplan_highlightMyName', JSON.stringify(highlightMyName));
    if (user && user.highlight_my_name !== highlightMyName) {
      updateMe({ highlight_my_name: highlightMyName }).catch((e) =>
        console.error('Pref save failed', e),
      );
    }
  }, [highlightMyName, updateMe, user]);

  useEffect(() => {
    localStorage.setItem('radioplan_showInitialsOnly', JSON.stringify(showInitialsOnly));
    if (user && user.schedule_initials_only !== showInitialsOnly) {
      updateMe({ schedule_initials_only: showInitialsOnly }).catch((e) =>
        console.error('Pref save failed', e),
      );
    }
  }, [showInitialsOnly, updateMe, user]);

  useEffect(() => {
    localStorage.setItem(
      'radioplan_sortDoctorsAlphabetically',
      JSON.stringify(sortDoctorsAlphabetically),
    );
    if (user && user.schedule_sort_doctors_alphabetically !== sortDoctorsAlphabetically) {
      updateMe({ schedule_sort_doctors_alphabetically: sortDoctorsAlphabetically }).catch((e) =>
        console.error('Pref save failed', e),
      );
    }
  }, [sortDoctorsAlphabetically, updateMe, user]);

  useEffect(() => {
    localStorage.setItem('radioplan_collapsedSections', JSON.stringify(collapsedSections));
    if (user) {
      if (JSON.stringify(user.collapsed_sections) !== JSON.stringify(collapsedSections)) {
        updateMe({ collapsed_sections: collapsedSections }).catch((e) =>
          console.error('Pref save failed', e),
        );
      }
    }
  }, [collapsedSections, updateMe, user]);

  useEffect(() => {
    localStorage.setItem(
      'radioplan_collapsedTimeslotGroups',
      JSON.stringify(collapsedTimeslotGroups),
    );
  }, [collapsedTimeslotGroups]);

  useEffect(() => {
    localStorage.setItem('radioplan_gridFontSize', JSON.stringify(gridFontSize));
  }, [gridFontSize]);

  // ====== Derived helpers ======
  const toggleTimeslotGroup = useCallback((workplaceName: string) => {
    setCollapsedTimeslotGroups((prev) =>
      prev.includes(workplaceName)
        ? prev.filter((n) => n !== workplaceName)
        : [...prev, workplaceName],
    );
  }, []);

  const sortDoctorsForDisplay = useCallback(
    <T extends { name?: string; initials?: string }>(doctorList: T[] = []): T[] => {
      if (!sortDoctorsAlphabetically) return doctorList;
      return [...doctorList].sort((a, b) => {
        const nameDiff = (a?.name || '').localeCompare(b?.name || '', 'de', {
          sensitivity: 'base',
        });
        if (nameDiff !== 0) return nameDiff;
        return (a?.initials || '').localeCompare(b?.initials || '', 'de', { sensitivity: 'base' });
      });
    },
    [sortDoctorsAlphabetically],
  );

  return {
    showSidebar,
    setShowSidebar,
    hiddenRows,
    setHiddenRows,
    collapsedSections,
    setCollapsedSections,
    highlightMyName,
    setHighlightMyName,
    showInitialsOnly,
    setShowInitialsOnly,
    sortDoctorsAlphabetically,
    setSortDoctorsAlphabetically,
    gridFontSize,
    setGridFontSize,
    collapsedTimeslotGroups,
    setCollapsedTimeslotGroups,
    toggleTimeslotGroup,
    sortDoctorsForDisplay,
  };
}
