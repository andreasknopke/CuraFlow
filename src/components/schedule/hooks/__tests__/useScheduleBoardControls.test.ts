import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScheduleBoardControls } from '../useScheduleBoardControls';

type ShiftEntryClientMock = {
  delete: (id: string) => Promise<unknown>;
  create: (data: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  bulkCreate: (data: Record<string, unknown>[]) => Promise<unknown>;
};

describe('useScheduleBoardControls', () => {
  const initialState = {
    currentDate: new Date('2026-04-14T00:00:00'),
    viewMode: 'week' as const,
    activeSectionTabId: 'main',
  };

  let shiftEntryClient: ShiftEntryClientMock;
  let onUndoSuccess: () => void;
  let alertMock: (message: string) => void;

  beforeEach(() => {
    shiftEntryClient = {
      delete: vi.fn(async (_id: string) => undefined),
      create: vi.fn(async (_data: Record<string, unknown>) => undefined),
      update: vi.fn(async (_id: string, _data: Record<string, unknown>) => undefined),
      bulkCreate: vi.fn(async (_data: Record<string, unknown>[]) => undefined),
    };
    onUndoSuccess = vi.fn();
    alertMock = vi.fn();
  });

  it('manages date/view state and undoes shift actions', async () => {
    const { result } = renderHook(() =>
      useScheduleBoardControls({
        initialState,
        shiftEntryClient,
        onUndoSuccess,
        alert: alertMock,
      }),
    );

    act(() => {
      result.current.setViewMode('month');
      result.current.setCurrentDate(new Date('2026-05-01T00:00:00'));
      result.current.setUndoStack([{ type: 'BULK_DELETE', ids: ['shift-1', 'shift-2'] }]);
    });

    expect(result.current.viewMode).toBe('month');
    expect(result.current.currentDate).toEqual(new Date('2026-05-01T00:00:00'));

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(shiftEntryClient.delete).toHaveBeenCalledTimes(2);
    expect(onUndoSuccess).toHaveBeenCalled();
    expect(result.current.undoStack).toEqual([]);
  });

  it('tracks ctrl key state and triggers undo on Ctrl+Z', async () => {
    const { result } = renderHook(() =>
      useScheduleBoardControls({
        initialState,
        shiftEntryClient,
        onUndoSuccess,
        alert: alertMock,
      }),
    );

    act(() => {
      result.current.setUndoStack([{ type: 'DELETE', id: 'shift-1' }]);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
    });
    expect(result.current.isCtrlPressed).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });

    await waitFor(() => {
      expect(shiftEntryClient.delete).toHaveBeenCalledWith('shift-1');
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('blur'));
    });
    expect(result.current.isCtrlPressed).toBe(false);
  });

  it('alerts when undo fails', async () => {
    shiftEntryClient.create = vi.fn(async () => {
      throw new Error('kaputt');
    });

    const { result } = renderHook(() =>
      useScheduleBoardControls({
        initialState,
        shiftEntryClient,
        onUndoSuccess,
        alert: alertMock,
      }),
    );

    act(() => {
      result.current.setUndoStack([{ type: 'CREATE', data: { id: 'shift-1' } }]);
    });

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(alertMock).toHaveBeenCalledWith('Rückgängig fehlgeschlagen: kaputt');
  });
});
