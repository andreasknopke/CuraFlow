import { describe, it, expect } from 'vitest';
import { buildRowQualSets, matchesRowQualFilter, rowKey } from '../rowQualFilter';

describe('rowQualFilter helpers', () => {
    describe('buildRowQualSets', () => {
        it('returns empty sets when workplaceId is missing', () => {
            const result = buildRowQualSets({
                workplaceId: null,
                getRequired: () => ['a'],
                getOptional: () => ['b'],
                getDiscouraged: () => ['c'],
                getExcluded: () => ['d'],
            });
            expect(result).toEqual({ includeIds: [], excludeIds: [] });
        });

        it('combines Pflicht, Sollte, and Sollte-nicht into includeIds', () => {
            const result = buildRowQualSets({
                workplaceId: 'wp-1',
                getRequired: () => ['q-pflicht'],
                getOptional: () => ['q-sollte'],
                getDiscouraged: () => ['q-sollte-nicht'],
                getExcluded: () => ['q-nicht'],
            });
            expect(result.includeIds).toEqual(
                expect.arrayContaining(['q-pflicht', 'q-sollte', 'q-sollte-nicht'])
            );
            expect(result.excludeIds).toEqual(['q-nicht']);
        });

        it('deduplicates ids appearing in multiple include sets', () => {
            const result = buildRowQualSets({
                workplaceId: 'wp-1',
                getRequired: () => ['q1', 'q2'],
                getOptional: () => ['q1', 'q3'],
                getDiscouraged: () => ['q2'],
                getExcluded: () => [],
            });
            expect([...result.includeIds].sort()).toEqual(['q1', 'q2', 'q3']);
        });

        it('tolerates missing getter functions', () => {
            const result = buildRowQualSets({
                workplaceId: 'wp-1',
                getRequired: undefined,
                getOptional: () => ['q1'],
                getDiscouraged: null,
                getExcluded: () => ['q2'],
            });
            expect(result.includeIds).toEqual(['q1']);
            expect(result.excludeIds).toEqual(['q2']);
        });
    });

    describe('matchesRowQualFilter', () => {
        it('passes when no filter is active', () => {
            expect(matchesRowQualFilter(null, ['q1'])).toBe(true);
            expect(matchesRowQualFilter(undefined, ['q1'])).toBe(true);
        });

        it('passes when filter has no ids (no qualifications defined)', () => {
            expect(matchesRowQualFilter({ includeIds: [], excludeIds: [] }, ['q1'])).toBe(true);
        });

        it('OR-includes doctors that hold at least one include qualification', () => {
            const filter = { includeIds: ['a', 'b'], excludeIds: [] };
            expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['b'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(true);
        });

        it('excludes doctors that hold none of the include qualifications', () => {
            const filter = { includeIds: ['a', 'b'], excludeIds: [] };
            expect(matchesRowQualFilter(filter, ['c'])).toBe(false);
            expect(matchesRowQualFilter(filter, [])).toBe(false);
        });

        it('excludes doctors that hold an exclude (Nicht) qualification', () => {
            const filter = { includeIds: ['a'], excludeIds: ['n1'] };
            expect(matchesRowQualFilter(filter, ['a', 'n1'])).toBe(false);
            expect(matchesRowQualFilter(filter, ['n1'])).toBe(false);
        });

        it('combines include-OR with exclude-NOT', () => {
            const filter = { includeIds: ['a', 'b'], excludeIds: ['x'] };
            expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['b'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['c'])).toBe(false);
            expect(matchesRowQualFilter(filter, ['a', 'x'])).toBe(false);
        });

        it('treats missing doctorQualIds as empty array', () => {
            const filter = { includeIds: ['a'], excludeIds: [] };
            expect(matchesRowQualFilter(filter, undefined)).toBe(false);
            expect(matchesRowQualFilter(filter, null)).toBe(false);
        });

        it('when no include rule is set, only excludes apply (Nur NOT ausschließen, Rest zeigen)', () => {
            // Row has only "Nicht" qualifications defined -> includeIds empty,
            // excludeIds populated. Doctors without the excluded qualification
            // must remain visible.
            const filter = { includeIds: [], excludeIds: ['n1'] };
            expect(matchesRowQualFilter(filter, [])).toBe(true);
            expect(matchesRowQualFilter(filter, ['a'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['a', 'b'])).toBe(true);
            expect(matchesRowQualFilter(filter, ['n1'])).toBe(false);
            expect(matchesRowQualFilter(filter, ['a', 'n1'])).toBe(false);
        });
    });

    describe('rowKey', () => {
        it('returns just the name when there is no timeslot', () => {
            expect(rowKey('Dienst Vordergrund', null)).toBe('Dienst Vordergrund');
            expect(rowKey('Dienst Vordergrund', undefined)).toBe('Dienst Vordergrund');
        });

        it('combines name and timeslot id with __ separator', () => {
            expect(rowKey('Mammographie', 'ts-1')).toBe('Mammographie__ts-1');
        });
    });
});
