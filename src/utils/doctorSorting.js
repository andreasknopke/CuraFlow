export const isAlphabeticalDoctorSortingEnabled = (user) => {
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

export const sortDoctorsAlphabetically = (doctorList = []) => {
  return [...doctorList].sort((a, b) => {
    const nameDiff = (a?.name || '').localeCompare(b?.name || '', 'de', { sensitivity: 'base' });
    if (nameDiff !== 0) return nameDiff;

    return (a?.initials || '').localeCompare(b?.initials || '', 'de', { sensitivity: 'base' });
  });
};