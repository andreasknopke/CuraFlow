import { useState, useCallback } from 'react';
import { Slider } from '@/components/ui/Slider';
import { Label } from '@/components/ui/Label';

const WINDOW_SIZE = 5; // 6-year window: start .. start+5 (inclusive)

export default function YearRangeSlider({ minYear, maxYear, startYear, onChange }) {
  const handleValueChange = useCallback(
    ([value]) => {
      const newStart = Math.max(minYear, Math.min(maxYear - WINDOW_SIZE, value));
      onChange(newStart, newStart + WINDOW_SIZE);
    },
    [minYear, maxYear, onChange]
  );

  return (
    <div className="px-4 py-2">
      <Label className="mb-2 block text-sm text-slate-600">
        Zeithorizont: {startYear} – {startYear + WINDOW_SIZE}
      </Label>
      <div className="relative">
        {/* Hintergrundleiste für den fixen 6-Jahres-Bereich */}
        <div
          className="absolute top-1/2 left-0 -translate-y-1/2 h-2 bg-blue-100 rounded-full"
          style={{
            left: `${((startYear - minYear) / (maxYear - minYear)) * 100}%`,
            width: `${(WINDOW_SIZE / (maxYear - minYear)) * 100}%`,
          }}
        />
        <Slider
          min={minYear}
          max={maxYear}
          step={1}
          value={[startYear]}
          onValueChange={handleValueChange}
          className="relative z-10"
        />
      </div>
    </div>
  );
}
