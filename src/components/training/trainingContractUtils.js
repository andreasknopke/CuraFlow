import { differenceInCalendarDays, format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;

  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  return value ? startOfDay(value) : null;
}

export function isDateWithinContract(date, contractStart, contractEnd) {
  const normalizedDate = normalizeDate(date);
  const start = normalizeDate(parseDate(contractStart));
  const end = normalizeDate(parseDate(contractEnd));

  if (!normalizedDate) return false;
  if (start && isBefore(normalizedDate, start)) return false;
  if (end && isAfter(normalizedDate, end)) return false;
  return true;
}

export function clampRangeToContract(startDate, endDate, contractStart, contractEnd) {
  const start = normalizeDate(parseDate(contractStart));
  const end = normalizeDate(parseDate(contractEnd));
  let normalizedStart = normalizeDate(startDate);
  let normalizedEnd = normalizeDate(endDate);

  if (!normalizedStart || !normalizedEnd) {
    return null;
  }

  if (isAfter(normalizedStart, normalizedEnd)) {
    const temp = normalizedStart;
    normalizedStart = normalizedEnd;
    normalizedEnd = temp;
  }

  if (start && isBefore(normalizedEnd, start)) return null;
  if (end && isAfter(normalizedStart, end)) return null;

  if (start && isBefore(normalizedStart, start)) {
    normalizedStart = start;
  }
  if (end && isAfter(normalizedEnd, end)) {
    normalizedEnd = end;
  }

  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
  };
}

export function getTrainingContractInfo(contractStart, contractEnd, referenceDate = new Date()) {
  const start = parseDate(contractStart);
  const end = parseDate(contractEnd);

  if (!start && !end) {
    return null;
  }

  const parts = [];
  if (start) {
    parts.push(format(start, 'dd.MM.yyyy'));
  }
  if (end) {
    parts.push(format(end, 'dd.MM.yyyy'));
  } else {
    parts.push('unbefristet');
  }

  let remainingLabel = 'unbefristet';
  let remainingTone = 'text-slate-500';

  if (end) {
    const today = startOfDay(referenceDate);
    const normalizedEnd = startOfDay(end);
    const remainingDays = differenceInCalendarDays(normalizedEnd, today);

    if (isBefore(normalizedEnd, today)) {
      remainingLabel = 'abgelaufen';
      remainingTone = 'text-rose-600';
    } else {
      const totalMonths = Math.floor((remainingDays + 1) / 30.44);
      const years = Math.floor(totalMonths / 12);
      const months = totalMonths % 12;
      const days = Math.max(remainingDays + 1 - Math.round(totalMonths * 30.44), 0);
      const durationParts = [];

      if (years > 0) durationParts.push(`${years} J`);
      if (months > 0) durationParts.push(`${months} M`);
      if (years === 0 && months === 0) durationParts.push(`${remainingDays + 1} T`);
      if (years === 0 && months > 0 && days > 0 && durationParts.length < 2) durationParts.push(`${days} T`);

      remainingLabel = `noch ${durationParts.join(' ')}`;
      if (remainingDays <= 90) remainingTone = 'text-rose-600';
      else if (remainingDays <= 180) remainingTone = 'text-amber-600';
      else remainingTone = 'text-emerald-600';
    }
  }

  return {
    contractStart: contractStart || null,
    contractEnd: contractEnd || null,
    contractRangeLabel: parts.join(' – '),
    remainingLabel,
    remainingTone,
  };
}
