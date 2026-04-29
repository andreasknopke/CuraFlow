import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/client';
import YearRangeSlider from '@/components/shared/YearRangeSlider';
import RotationTimeline from '@/components/training/RotationTimeline';

const CURRENT_YEAR = new Date().getFullYear();
const SLIDER_MIN = CURRENT_YEAR - 10;
const SLIDER_MAX = CURRENT_YEAR + 10;
const DEFAULT_START = Math.max(SLIDER_MIN, CURRENT_YEAR - 2); // provides a 6-year window starting 2 years ago

export default function Training() {
  const [rangeStart, setRangeStart] = useState(DEFAULT_START);
  const rangeEnd = rangeStart + 5; // inclusive end → 6 years

  const { data: rotations = [], isLoading } = useQuery({
    queryKey: ['trainingRotations', rangeStart, rangeEnd],
    queryFn: () =>
      db.TrainingRotation.filter({
        filter: {
          $or: [
            { start_date: { $lte: `${rangeEnd}-12-31` } },
            { end_date: { $gte: `${rangeStart}-01-01` } },
          ],
        },
        limit: 500,
      }),
    staleTime: 60 * 1000,
  });

  const handleRangeChange = (newStart) => {
    setRangeStart(newStart);
  };

  return (
    <div className="flex flex-col h-full">
      <YearRangeSlider
        minYear={SLIDER_MIN}
        maxYear={SLIDER_MAX}
        startYear={rangeStart}
        onChange={handleRangeChange}
      />
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="text-center text-gray-500">Lade Rotationen …</p>
        ) : (
          <RotationTimeline
            rotations={rotations}
            startYear={rangeStart}
            endYear={rangeEnd}
          />
        )}
      </div>
    </div>
  );
}
