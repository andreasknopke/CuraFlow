import { useCallback, useEffect, useState } from 'react';
import type { ScheduleInitialState, ViewMode } from '../utils/scheduleFormatters';

interface UndoAction {
  type: 'DELETE' | 'CREATE' | 'UPDATE' | 'BULK_CREATE' | 'BULK_DELETE';
  id?: string;
  ids?: string[];
  data?: Record<string, unknown> | Record<string, unknown>[];
}

interface ShiftEntryClient {
  delete: (id: string) => Promise<unknown>;
  create: (data: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  bulkCreate: (data: Record<string, unknown>[]) => Promise<unknown>;
}

interface UseScheduleBoardControlsOptions {
  initialState: ScheduleInitialState;
  shiftEntryClient: ShiftEntryClient;
  onUndoSuccess: () => void;
  alert: (message: string) => void;
}

export function useScheduleBoardControls({
  initialState,
  shiftEntryClient,
  onUndoSuccess,
  alert,
}: UseScheduleBoardControlsOptions) {
  const [currentDate, setCurrentDate] = useState(initialState.currentDate);
  const [viewMode, setViewMode] = useState<ViewMode>(initialState.viewMode);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;

    const item = undoStack[undoStack.length - 1];
    setUndoStack((previous) => previous.slice(0, -1));

    const actions = Array.isArray(item) ? item : [item];

    try {
      for (const action of actions) {
        if (action.type === 'DELETE' && action.id) {
          await shiftEntryClient.delete(action.id);
        } else if (action.type === 'CREATE' && action.data && !Array.isArray(action.data)) {
          await shiftEntryClient.create(action.data);
        } else if (
          action.type === 'UPDATE' &&
          action.id &&
          action.data &&
          !Array.isArray(action.data)
        ) {
          await shiftEntryClient.update(action.id, action.data);
        } else if (action.type === 'BULK_CREATE' && Array.isArray(action.data)) {
          await shiftEntryClient.bulkCreate(action.data);
        } else if (action.type === 'BULK_DELETE' && action.ids) {
          await Promise.all(action.ids.map((id: string) => shiftEntryClient.delete(id)));
        }
      }

      onUndoSuccess();
    } catch (error) {
      console.error('Undo failed', error);
      alert(
        `Rückgängig fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
      );
    }
  }, [alert, onUndoSuccess, shiftEntryClient, undoStack]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') setIsCtrlPressed(true);
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault();
        handleUndo();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') setIsCtrlPressed(false);
    };

    const handleBlur = () => setIsCtrlPressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleUndo]);

  return {
    currentDate,
    setCurrentDate,
    viewMode,
    setViewMode,
    isGenerating,
    setIsGenerating,
    isCtrlPressed,
    undoStack,
    setUndoStack,
    handleUndo,
  };
}
