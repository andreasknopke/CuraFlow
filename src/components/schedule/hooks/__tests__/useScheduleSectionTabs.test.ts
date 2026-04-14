import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScheduleSectionTabs } from '../useScheduleSectionTabs';

const allSections = [
  { title: 'Anwesenheiten' },
  { title: 'Dienste' },
  { title: 'Rotationen' },
  { title: 'Sonstiges' },
];

const sectionTabs = [{ id: 'dienste-tab', sectionTitle: 'Dienste' }];

describe('useScheduleSectionTabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/?date=2026-04-14');
  });

  it('derives visible sections and resets invalid active tabs to main', async () => {
    const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
    const persistSectionTabs = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ tabs }) =>
        useScheduleSectionTabs({
          initialActiveSectionTabId: 'dienste-tab',
          allSections,
          sectionTabs: tabs,
          isLoadingSystemSettings: false,
          isMobile: false,
          isEmbeddedSchedule: false,
          viewMode: 'week',
          currentDate: new Date('2026-04-14T00:00:00'),
          getSectionName: (name) => name,
          persistSectionTabs,
          toast,
        }),
      { initialProps: { tabs: sectionTabs } },
    );

    expect(result.current.sections).toEqual([{ title: 'Dienste' }, { title: 'Anwesenheiten' }]);

    rerender({ tabs: [] });

    await waitFor(() => {
      expect(result.current.activeSectionTabId).toBe('main');
      expect(result.current.sections).toEqual(allSections);
    });
  });

  it('opens split view only when allowed and disables it in month view', async () => {
    const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
    const persistSectionTabs = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook<
      ReturnType<typeof useScheduleSectionTabs>,
      { viewMode: 'week' | 'month'; isMobile: boolean }
    >(
      ({ viewMode, isMobile }) =>
        useScheduleSectionTabs({
          initialActiveSectionTabId: 'main',
          allSections,
          sectionTabs,
          isLoadingSystemSettings: false,
          isMobile,
          isEmbeddedSchedule: false,
          viewMode,
          currentDate: new Date('2026-04-14T00:00:00'),
          getSectionName: (name) => name,
          persistSectionTabs,
          toast,
        }),
      { initialProps: { viewMode: 'week' as const, isMobile: false } },
    );

    act(() => {
      result.current.handleOpenSectionTabInSplitView('dienste-tab');
    });

    expect(result.current.isSplitViewEnabled).toBe(true);
    expect(result.current.splitSections).toEqual([
      { title: 'Dienste' },
      { title: 'Anwesenheiten' },
    ]);

    rerender({ viewMode: 'month' as const, isMobile: false });

    await waitFor(() => {
      expect(result.current.isSplitViewEnabled).toBe(false);
    });

    rerender({ viewMode: 'week' as const, isMobile: true });

    act(() => {
      result.current.handleOpenSectionTabInSplitView('dienste-tab');
    });

    expect(result.current.isSplitViewEnabled).toBe(false);
  });

  it('moves sections into tabs, reuses existing tabs, and closes active tabs', async () => {
    const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
    const persistSectionTabs = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useScheduleSectionTabs({
        initialActiveSectionTabId: 'main',
        allSections,
        sectionTabs,
        isLoadingSystemSettings: false,
        isMobile: false,
        isEmbeddedSchedule: false,
        viewMode: 'week',
        currentDate: new Date('2026-04-14T00:00:00'),
        getSectionName: (name) => name,
        persistSectionTabs,
        toast,
      }),
    );

    await act(async () => {
      await result.current.handleMoveSectionToTab('Rotationen');
    });

    expect(persistSectionTabs).toHaveBeenCalledWith([
      { id: 'dienste-tab', sectionTitle: 'Dienste' },
      expect.objectContaining({ sectionTitle: 'Rotationen' }),
    ]);
    expect(toast.success).toHaveBeenCalled();
    expect(result.current.activeSectionTabId).toMatch(/^tab_\d+_rotationen$/);

    act(() => {
      result.current.handleOpenSectionTabInSplitView('dienste-tab');
    });

    act(() => {
      result.current.setIsSplitViewEnabled(false);
    });

    await act(async () => {
      await result.current.handleMoveSectionToTab('Dienste');
    });

    expect(result.current.activeSectionTabId).toBe('dienste-tab');

    await act(async () => {
      await result.current.handleCloseSectionTab('dienste-tab');
    });

    expect(persistSectionTabs).toHaveBeenLastCalledWith([
      expect.objectContaining({ sectionTitle: 'Rotationen' }),
    ]);
    expect(result.current.activeSectionTabId).toBe('main');
  });

  it('opens a tab in a new window and handles popup blocking', () => {
    const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
    const persistSectionTabs = vi.fn().mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, 'open');

    openSpy.mockReturnValue({} as Window);

    const { result } = renderHook(() =>
      useScheduleSectionTabs({
        initialActiveSectionTabId: 'dienste-tab',
        allSections,
        sectionTabs,
        isLoadingSystemSettings: false,
        isMobile: false,
        isEmbeddedSchedule: false,
        viewMode: 'week',
        currentDate: new Date('2026-04-14T00:00:00'),
        getSectionName: (name) => name,
        persistSectionTabs,
        toast,
      }),
    );

    act(() => {
      result.current.handleOpenSectionTabInNewWindow('dienste-tab');
    });

    expect(openSpy).toHaveBeenCalled();
    expect(result.current.activeSectionTabId).toBe('main');

    openSpy.mockReturnValue(null);

    act(() => {
      result.current.handleOpenSectionTabInNewWindow('dienste-tab');
    });

    expect(toast.error).toHaveBeenCalledWith('Neues Fenster wurde vom Browser blockiert');
  });
});
