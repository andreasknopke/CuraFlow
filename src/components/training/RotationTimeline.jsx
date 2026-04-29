import React from 'react';

function parseYearFromDate(dateValue) {
  if (!dateValue || typeof dateValue !== 'string') return null;
  const year = Number(dateValue.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function isWithinVisibleRange(rotation, startYear, endYear) {
  const start = parseYearFromDate(rotation?.start_date);
  const end = parseYearFromDate(rotation?.end_date);
  if (start === null || end === null) return false;
  return !(end < startYear || start > endYear);
}

export default function RotationTimeline({ rotations = [], startYear, endYear }) {
  const visibleRotations = React.useMemo(() => {
    return rotations
      .filter((rotation) => isWithinVisibleRange(rotation, startYear, endYear))
      .sort((a, b) => {
        const aStart = a?.start_date || '';
        const bStart = b?.start_date || '';
        return aStart.localeCompare(bStart);
      });
  }, [rotations, startYear, endYear]);

  if (visibleRotations.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Keine Rotationen im gewaehlten Zeitraum.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleRotations.map((rotation) => (
        <div
          key={rotation.id || `${rotation.doctor_id}-${rotation.start_date}-${rotation.end_date}`}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="text-sm font-semibold text-slate-900">{rotation.modality || 'Ohne Bereich'}</div>
          <div className="mt-1 text-sm text-slate-600">
            {rotation.start_date} bis {rotation.end_date}
          </div>
        </div>
      ))}
    </div>
  );
}
