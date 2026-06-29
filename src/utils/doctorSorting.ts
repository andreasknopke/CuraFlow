/**
 * CuraFlow — Doctor Sorting Utilities
 *
 * Alphabetical sorting for doctor lists on the schedule board.
 * Sort order is controlled by a user preference (stored in user object or localStorage).
 *
 * @module utils/doctorSorting
 */

interface DoctorSortable {
  name?: string | null;
  initials?: string | null;
}

interface UserPreference {
  schedule_sort_doctors_alphabetically?: boolean;
}

/**
 * Checks whether alphabetical sorting is enabled for a given user.
 * Falls back to localStorage preference if user object doesn't specify.
 */
export const isAlphabeticalDoctorSortingEnabled = (user: UserPreference | null | undefined): boolean => {
  if (user?.schedule_sort_doctors_alphabetically !== undefined) {
    return user.schedule_sort_doctors_alphabetically === true;
  }

  try {
    const saved = localStorage.getItem('radioplan_sortDoctorsAlphabetically');
    return saved ? JSON.parse(saved) === true : false;
  } catch {
    return false;
  }
};

/**
 * Sorts a list of doctors alphabetically by name, then by initials.
 * Uses German locale for correct umlaut handling.
 * Returns a new array — does not mutate the input.
 */
export const sortDoctorsAlphabetically = <T extends DoctorSortable>(doctorList: T[] = []): T[] => {
  return [...doctorList].sort((a, b) => {
    const nameDiff = (a?.name || '').localeCompare(b?.name || '', 'de', { sensitivity: 'base' });
    if (nameDiff !== 0) return nameDiff;

    return (a?.initials || '').localeCompare(b?.initials || '', 'de', { sensitivity: 'base' });
  });
};
