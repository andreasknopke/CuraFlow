import { describe, expect, it } from 'vitest';
import { applyAlwaysVisibleRowsToSection, parseAlwaysVisibleRows } from '@/components/schedule/sectionVisibility';

describe('parseAlwaysVisibleRows', () => {
    it('returns unique valid row visibility entries', () => {
        const result = parseAlwaysVisibleRows(JSON.stringify([
            { rowName: 'Spätdienst', targetSectionTitle: 'Rotationen' },
            { rowName: 'Spätdienst', targetSectionTitle: 'Rotationen' },
            { rowName: '', targetSectionTitle: 'Rotationen' },
            { rowName: 'Dienst Hintergrund' },
        ]));

        expect(result).toEqual([
            { rowName: 'Spätdienst', targetSectionTitle: 'Rotationen' },
        ]);
    });

    it('returns an empty list for invalid JSON', () => {
        expect(parseAlwaysVisibleRows('{nope')).toEqual([]);
    });
});

describe('applyAlwaysVisibleRowsToSection', () => {
    it('adds configured rows to the target section without removing them from their source section', () => {
        const sections = [
            { title: 'Dienste', rows: [{ name: 'Spätdienst', displayName: 'Spätdienst' }] },
            { title: 'Rotationen', rows: [{ name: 'CT', displayName: 'CT' }] },
        ];

        const result = applyAlwaysVisibleRowsToSection(sections, 'Rotationen', [
            { rowName: 'Spätdienst', targetSectionTitle: 'Rotationen' },
        ]);

        expect(result.find((section) => section.title === 'Dienste').rows).toHaveLength(1);
        expect(result.find((section) => section.title === 'Rotationen').rows).toEqual([
            { name: 'CT', displayName: 'CT' },
            {
                name: 'Spätdienst',
                displayName: 'Spätdienst',
                isAlwaysVisibleRow: true,
                sourceSectionTitle: 'Dienste',
            },
        ]);
    });

    it('does not duplicate rows that already exist in the target section', () => {
        const sections = [
            { title: 'Dienste', rows: [{ name: 'Spätdienst', displayName: 'Spätdienst' }] },
            { title: 'Rotationen', rows: [{ name: 'Spätdienst', displayName: 'Spätdienst' }] },
        ];

        const result = applyAlwaysVisibleRowsToSection(sections, 'Rotationen', [
            { rowName: 'Spätdienst', targetSectionTitle: 'Rotationen' },
        ]);

        expect(result.find((section) => section.title === 'Rotationen').rows).toHaveLength(1);
    });
});