import { useState } from 'react';
import { format } from 'date-fns';

interface PreviewShiftLike {
  id?: string;
  isPreview?: boolean;
  [key: string]: unknown;
}

interface QueryClientLike {
  invalidateQueries: (options: { queryKey: string[] }) => unknown;
}

interface ToastLike {
  success: (message: string) => void;
}

interface UseScheduleBoardCommandsOptions {
  weekDays: Date[];
  hiddenRows: string[];
  previewShifts: PreviewShiftLike[] | null;
  setPreviewShifts: (value: PreviewShiftLike[] | null) => void;
  setPreviewCategories: (value: string[] | null) => void;
  bulkCreateShifts: (data: Record<string, unknown>[]) => Promise<unknown>;
  exportScheduleToExcel: (
    start: string,
    end: string,
    hiddenRows: string[],
  ) => Promise<{ file: string }>;
  queryClient: QueryClientLike;
  toast: ToastLike;
  alert: (message: string) => void;
}

export function useScheduleBoardCommands({
  weekDays,
  hiddenRows,
  previewShifts,
  setPreviewShifts,
  setPreviewCategories,
  bulkCreateShifts,
  exportScheduleToExcel,
  queryClient,
  toast,
  alert,
}: UseScheduleBoardCommandsOptions) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const startDate = weekDays[0];
      const endDate = weekDays[weekDays.length - 1];

      const data = await exportScheduleToExcel(
        format(startDate, 'yyyy-MM-dd'),
        format(endDate, 'yyyy-MM-dd'),
        hiddenRows,
      );

      const byteCharacters = atob(data.file);
      const byteNumbers = new Array(byteCharacters.length);
      for (let index = 0; index < byteCharacters.length; index += 1) {
        byteNumbers[index] = byteCharacters.charCodeAt(index);
      }

      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Wochenplan_${format(startDate, 'yyyy-MM-dd')}_bis_${format(endDate, 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
      anchor.remove();
    } catch (error) {
      console.error('Export Error:', error);
      alert(
        `Export fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
      );
    } finally {
      setIsExporting(false);
    }
  };

  const applyPreview = async () => {
    if (!previewShifts) return;

    const shiftsToCreate = previewShifts.map(({ isPreview: _isPreview, id: _id, ...rest }) => rest);
    await bulkCreateShifts(shiftsToCreate);
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
    setPreviewShifts(null);
    setPreviewCategories(null);
    toast.success(`${shiftsToCreate.length} Einträge übernommen`);
  };

  const cancelPreview = () => {
    setPreviewShifts(null);
    setPreviewCategories(null);
  };

  return {
    isExporting,
    handleExportExcel,
    applyPreview,
    cancelPreview,
  };
}
