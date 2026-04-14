export const toSqlValue = (value) => {
  if (value === undefined) return null;
  if (value === '') return null;
  if (typeof value === 'number' && isNaN(value)) return null;
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  return value;
};

export const fromSqlRow = (row) => {
  if (!row) return null;
  const result = { ...row };

  const jsonFields = ['active_days'];
  const boolFields = [
    'receive_email_notifications',
    'exclude_from_staffing_plan',
    'user_viewed',
    'auto_off',
    'show_in_service_plan',
    'allows_rotation_concurrently',
    'acknowledged',
    'is_active',
    'is_specialist',
    'timeslots_enabled',
    'spans_midnight',
    'affects_availability',
    'can_do_foreground_duty',
    'can_do_background_duty',
    'excluded_from_statistics',
    'is_mandatory',
  ];

  for (const key in result) {
    if (jsonFields.includes(key) && typeof result[key] === 'string') {
      try {
        result[key] = JSON.parse(result[key]);
      } catch (error) {
        // Keep raw string if it is not valid JSON.
      }
    }

    if (boolFields.includes(key)) {
      result[key] = !!result[key];
    }
  }

  return result;
};
