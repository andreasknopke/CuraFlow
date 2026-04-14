import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScheduleBoardCommands } from '../useScheduleBoardCommands';

type SetPreviewShifts = (value: Array<Record<string, unknown>> | null) => void;
type SetPreviewCategories = (value: string[] | null) => void;
type BulkCreateShifts = (data: Record<string, unknown>[]) => Promise<unknown>;
type ExportScheduleToExcel = (
  start: string,
  end: string,
  hiddenRows: string[],
) => Promise<{ file: string }>;
type QueryClientLike = { invalidateQueries: (options: { queryKey: string[] }) => unknown };
type ToastLike = { success: (message: string) => void };

describe('useScheduleBoardCommands', () => {
  const weekDays = [new Date('2026-04-13T00:00:00'), new Date('2026-04-19T00:00:00')];

  let setPreviewShifts: SetPreviewShifts;
  let setPreviewCategories: SetPreviewCategories;
  let bulkCreateShifts: BulkCreateShifts;
  let exportScheduleToExcel: ExportScheduleToExcel;
  let queryClient: QueryClientLike;
  let toast: ToastLike;
  let alertMock: (message: string) => void;

  beforeEach(() => {
    setPreviewShifts = vi.fn();
    setPreviewCategories = vi.fn();
    bulkCreateShifts = vi.fn(async (_data: Record<string, unknown>[]) => undefined);
    exportScheduleToExcel = vi.fn(async () => ({ file: btoa('excel-data') }));
    queryClient = { invalidateQueries: vi.fn() };
    toast = { success: vi.fn() };
    alertMock = vi.fn();
    window.URL.createObjectURL = vi.fn(() => 'blob:mock');
    window.URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it('applies and cancels preview shifts', async () => {
    const { result } = renderHook(() =>
      useScheduleBoardCommands({
        weekDays,
        hiddenRows: [],
        previewShifts: [
          {
            id: 'preview-1',
            isPreview: true,
            date: '2026-04-13',
            position: 'Dienst A',
            doctor_id: 'doc-1',
          },
        ],
        setPreviewShifts,
        setPreviewCategories,
        bulkCreateShifts,
        exportScheduleToExcel,
        queryClient,
        toast,
        alert: alertMock,
      }),
    );

    await act(async () => {
      await result.current.applyPreview();
    });

    expect(bulkCreateShifts).toHaveBeenCalledWith([
      { date: '2026-04-13', position: 'Dienst A', doctor_id: 'doc-1' },
    ]);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['shifts'] });
    expect(setPreviewShifts).toHaveBeenCalledWith(null);
    expect(setPreviewCategories).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('1 Einträge übernommen');

    act(() => {
      result.current.cancelPreview();
    });

    expect(setPreviewShifts).toHaveBeenCalledWith(null);
    expect(setPreviewCategories).toHaveBeenCalledWith(null);
  });

  it('exports the current date range and handles failures', async () => {
    const { result, rerender } = renderHook(
      ({ exporter }) =>
        useScheduleBoardCommands({
          weekDays,
          hiddenRows: ['Dienst A'],
          previewShifts: null,
          setPreviewShifts,
          setPreviewCategories,
          bulkCreateShifts,
          exportScheduleToExcel: exporter,
          queryClient,
          toast,
          alert: alertMock,
        }),
      { initialProps: { exporter: exportScheduleToExcel } },
    );

    await act(async () => {
      await result.current.handleExportExcel();
    });

    expect(exportScheduleToExcel).toHaveBeenCalledWith('2026-04-13', '2026-04-19', ['Dienst A']);
    expect(window.URL.createObjectURL).toHaveBeenCalled();

    const failingExporter: ExportScheduleToExcel = vi.fn(async () => {
      throw new Error('kaputt');
    });
    rerender({ exporter: failingExporter });

    await act(async () => {
      await result.current.handleExportExcel();
    });

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Export fehlgeschlagen: kaputt');
    });
  });
});
