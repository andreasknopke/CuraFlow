// @ts-nocheck
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockExportScheduleToExcel,
  mockBulkCreate,
  mockCreate,
  mockUpdate,
  mockDelete,
  mockList,
  mockUpdateMe,
  mockGenerateSuggestions,
  mockValidate,
  mockRequestOverride,
  mockToast,
  mockInvalidateQueries,
  mockCancelQueries,
  mockGetQueryData,
  mockSetQueryData,
} = vi.hoisted(() => ({
  mockExportScheduleToExcel: vi.fn(),
  mockBulkCreate: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockList: vi.fn(),
  mockUpdateMe: vi.fn(),
  mockGenerateSuggestions: vi.fn(),
  mockValidate: vi.fn(),
  mockRequestOverride: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockInvalidateQueries: vi.fn(),
  mockCancelQueries: vi.fn(),
  mockGetQueryData: vi.fn(),
  mockSetQueryData: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    exportScheduleToExcel: mockExportScheduleToExcel,
  },
  db: {
    Doctor: {
      update: mockUpdate,
    },
    ShiftEntry: {
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      bulkCreate: mockBulkCreate,
    },
    SystemSetting: {
      list: mockList,
      create: mockCreate,
      update: mockUpdate,
    },
    ScheduleNote: {
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
    ScheduleBlock: {
      create: mockCreate,
      delete: mockDelete,
    },
  },
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({
    isReadOnly: false,
    user: {
      id: 'user-1',
      name: 'Test User',
      calendar_email: 'plan@example.com',
    },
    updateMe: mockUpdateMe,
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/settings/SectionConfigDialog', () => ({
  useSectionConfig: () => ({
    getSectionName: (title: string) => title,
    getSectionOrder: () => ['Anwesenheiten', 'Abwesenheiten', 'Dienste', 'Sonstiges'],
  }),
}));

vi.mock('@/hooks/useQualifications', () => ({
  useAllDoctorQualifications: () => ({
    hasQualificationForWorkplace: () => true,
  }),
  useAllWorkplaceQualifications: () => ({
    getRequiredQualificationsForWorkplace: () => [],
  }),
}));

vi.mock('@/hooks/useHolidays', () => ({
  useHolidays: () => ({
    isPublicHoliday: () => false,
    isSchoolHoliday: () => false,
  }),
}));

vi.mock('@/components/validation/useShiftValidation', () => ({
  useShiftValidation: () => ({
    validate: mockValidate,
    shouldCreateAutoFrei: () => null,
    findAutoFreiToCleanup: () => null,
    isAutoOffPosition: () => false,
  }),
}));

vi.mock('@/components/validation/useOverrideValidation', () => ({
  useOverrideValidation: () => ({
    overrideDialog: {
      open: false,
      blockers: [],
      warnings: [],
      context: {},
    },
    requestOverride: mockRequestOverride,
    confirmOverride: vi.fn(),
    cancelOverride: vi.fn(),
    setOverrideDialogOpen: vi.fn(),
  }),
}));

vi.mock('@/components/validation/OverrideConfirmDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="override-dialog" /> : null),
}));

vi.mock('./../autoFillEngine', () => ({
  generateSuggestions: mockGenerateSuggestions,
}));

vi.mock('./../ScheduleToolbar', () => ({
  default: ({
    viewMode,
    previewShifts,
    isSplitViewEnabled,
    showSidebar,
    setViewMode,
    setShowSidebar,
    onAutoFill,
    onApplyPreview,
    onCancelPreview,
    onExportExcel,
    onOpenSectionTabInSplitView,
    onCloseSectionTab,
  }: any) => (
    <div data-testid="schedule-toolbar">
      <div data-testid="toolbar-view">{viewMode}</div>
      <div data-testid="toolbar-preview-count">{previewShifts?.length ?? 0}</div>
      <div data-testid="toolbar-split-state">{String(isSplitViewEnabled)}</div>
      <div data-testid="toolbar-sidebar-state">{String(showSidebar)}</div>
      <button onClick={() => setViewMode('month')}>Monat</button>
      <button onClick={() => setViewMode('week')}>Woche</button>
      <button onClick={() => onAutoFill(['Dienste'])}>Autofill</button>
      <button onClick={onApplyPreview}>Preview anwenden</button>
      <button onClick={onCancelPreview}>Preview verwerfen</button>
      <button onClick={onExportExcel}>Export</button>
      <button onClick={() => setShowSidebar(false)}>Sidebar aus</button>
      <button onClick={() => onOpenSectionTabInSplitView('dienste-tab')}>Split an</button>
      <button onClick={() => onCloseSectionTab('dienste-tab')}>Tab schliessen</button>
    </div>
  ),
}));

vi.mock('./../ScheduleSidebar', () => ({
  default: ({ sidebarDoctors }: any) => (
    <div data-testid="schedule-sidebar">Sidebar:{sidebarDoctors.length}</div>
  ),
}));

vi.mock('./../MobileScheduleView', () => ({
  default: () => <div data-testid="mobile-schedule-view" />,
}));

vi.mock('./../DraggableShift', () => ({
  default: () => <div data-testid="draggable-shift" />,
}));

vi.mock('./../DroppableCell', () => ({
  default: ({ children, droppableId }: any) => (
    <div data-testid={`droppable-cell-${droppableId}`}>{children}</div>
  ),
}));

vi.mock('./../FreeTextCell', () => ({
  default: () => <div data-testid="free-text-cell" />,
}));

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children, onDragEnd }: any) => (
    <div data-testid="drag-context">
      <button
        onClick={() =>
          onDragEnd({
            draggableId: 'available-doc-doc-1-2026-04-13',
            source: { droppableId: 'available__2026-04-13', index: 0 },
            destination: { droppableId: '2026-04-13__Dienst A', index: 0 },
            reason: 'DROP',
          })
        }
      >
        Drag create
      </button>
      {children}
    </div>
  ),
  Droppable: ({ children, droppableId }: any) => (
    <div data-testid={`droppable-${droppableId}`}>
      {children(
        { innerRef: vi.fn(), droppableProps: {}, placeholder: null },
        { isDraggingOver: false, draggingOverWith: null },
      )}
    </div>
  ),
  Draggable: ({ children, draggableId, index }: any) =>
    children(
      {
        innerRef: vi.fn(),
        draggableProps: {},
        dragHandleProps: {},
      },
      { isDragging: false },
      { draggableId, source: { index, droppableId: 'mock' } },
    ),
}));

vi.mock('./../hooks/useScheduleData', () => ({
  useScheduleData: () => ({
    queryClient: {
      invalidateQueries: mockInvalidateQueries,
      cancelQueries: mockCancelQueries,
      getQueryData: mockGetQueryData,
      setQueryData: mockSetQueryData,
    },
    fetchRange: { start: '2026-04-01', end: '2026-04-30' },
    fairnessRange: { start: '2026-03-11', end: '2026-04-30' },
    staffingYear: 2026,
    doctors: [
      {
        id: 'doc-1',
        name: 'Dr. One',
        initials: 'ONE',
        role: 'Facharzt',
        order: 0,
        active: true,
        fte: 1,
      },
    ],
    allShifts: [],
    fairnessShifts: [],
    wishes: [],
    workplaces: [
      {
        id: 'wp-1',
        name: 'Dienst A',
        category: 'Dienste',
        order: 0,
        active_days: [1, 2, 3, 4, 5],
        timeslots_enabled: false,
      },
    ],
    workplaceTimeslots: [],
    systemSettings: [],
    isLoadingSystemSettings: false,
    sectionTabs: [{ id: 'dienste-tab', sectionTitle: 'Dienste' }],
    staffingPlanEntries: [],
    workTimeModels: [],
    workTimeModelMap: new Map(),
    trainingRotations: [],
    colorSettings: [],
    isLoadingColors: false,
    scheduleNotes: [],
    scheduleNotesMap: new Map(),
    scheduleBlocks: [],
  }),
}));

vi.mock('./../hooks/useSchedulePreferences', async () => {
  const React = await import('react');

  return {
    useSchedulePreferences: () => {
      const [showSidebar, setShowSidebar] = React.useState(true);
      const [hiddenRows, setHiddenRows] = React.useState<string[]>([]);
      const [collapsedSections, setCollapsedSections] = React.useState<string[]>([]);
      const [collapsedTimeslotGroups, setCollapsedTimeslotGroups] = React.useState<string[]>([]);
      const [highlightMyName, setHighlightMyName] = React.useState(false);
      const [showInitialsOnly, setShowInitialsOnly] = React.useState(false);
      const [sortDoctorsAlphabetically, setSortDoctorsAlphabetically] = React.useState(false);
      const [gridFontSize, setGridFontSize] = React.useState(12);

      const toggleTimeslotGroup = (workplaceName: string) => {
        setCollapsedTimeslotGroups((prev) =>
          prev.includes(workplaceName)
            ? prev.filter((name) => name !== workplaceName)
            : [...prev, workplaceName],
        );
      };

      const sortDoctorsForDisplay = <T extends { name?: string }>(list: T[] = []) =>
        sortDoctorsAlphabetically
          ? [...list].sort((left, right) => (left.name || '').localeCompare(right.name || '', 'de'))
          : list;

      return {
        showSidebar,
        setShowSidebar,
        hiddenRows,
        setHiddenRows,
        collapsedSections,
        setCollapsedSections,
        highlightMyName,
        setHighlightMyName,
        showInitialsOnly,
        setShowInitialsOnly,
        sortDoctorsAlphabetically,
        setSortDoctorsAlphabetically,
        gridFontSize,
        setGridFontSize,
        collapsedTimeslotGroups,
        toggleTimeslotGroup,
        sortDoctorsForDisplay,
      };
    },
  };
});

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import ScheduleBoard from './../ScheduleBoard';

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ScheduleBoard />
    </QueryClientProvider>,
  );
}

describe('ScheduleBoard', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/?date=2026-04-13');

    mockExportScheduleToExcel.mockResolvedValue({ file: btoa('excel-data') });
    mockBulkCreate.mockResolvedValue([{ id: 'shift-created-1' }]);
    mockCreate.mockResolvedValue({ id: 'shift-created-1' });
    mockUpdate.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
    mockList.mockResolvedValue([]);
    mockGenerateSuggestions.mockReturnValue([
      {
        id: 'preview-1',
        date: '2026-04-13',
        position: 'Dienst A',
        doctor_id: 'doc-1',
        isPreview: true,
      },
    ]);
    mockValidate.mockReturnValue({ blockers: [], warnings: [] });
    mockRequestOverride.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockToast.info.mockReset();
    mockToast.warning.mockReset();
    mockBulkCreate.mockClear();
    mockExportScheduleToExcel.mockClear();
    mockInvalidateQueries.mockClear();
    mockCancelQueries.mockClear();
    mockGetQueryData.mockReset();
    mockSetQueryData.mockClear();
    mockUpdateMe.mockClear();

    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the board shell, toggles split view, and hides the sidebar', async () => {
    renderBoard();

    expect(screen.getByTestId('schedule-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-view')).toHaveTextContent('week');

    fireEvent.click(screen.getByText('Split an'));
    expect(screen.getByTestId('toolbar-split-state')).toHaveTextContent('true');

    fireEvent.click(screen.getByText('Monat'));
    await waitFor(() => {
      expect(screen.getByTestId('toolbar-view')).toHaveTextContent('month');
      expect(screen.getByTestId('toolbar-split-state')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByText('Sidebar aus'));
    await waitFor(() => {
      expect(screen.queryByTestId('schedule-sidebar')).not.toBeInTheDocument();
      expect(screen.getByTestId('toolbar-sidebar-state')).toHaveTextContent('false');
    });
  });

  it('creates a preview via autofill and applies it', async () => {
    renderBoard();

    fireEvent.click(screen.getByText('Autofill'));

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-preview-count')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByText('Preview anwenden'));

    await waitFor(() => {
      expect(mockBulkCreate).toHaveBeenCalledWith([
        {
          date: '2026-04-13',
          position: 'Dienst A',
          doctor_id: 'doc-1',
        },
      ]);
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['shifts'] });
      expect(screen.getByTestId('toolbar-preview-count')).toHaveTextContent('0');
    });
  });

  it('exports the visible date range to Excel', async () => {
    renderBoard();

    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(mockExportScheduleToExcel).toHaveBeenCalledWith('2026-04-13', '2026-04-19', []);
    });
  });

  it('creates a shift when a doctor is dropped from the availability lane onto the grid', async () => {
    renderBoard();

    fireEvent.click(screen.getByText('Drag create'));

    await waitFor(() => {
      expect(mockBulkCreate).toHaveBeenCalledWith([
        {
          date: '2026-04-13',
          position: 'Dienst A',
          doctor_id: 'doc-1',
          order: 0,
        },
      ]);
    });
  });

  it('requests an override instead of creating a shift when validation blocks the drop', async () => {
    mockValidate.mockReturnValue({
      blockers: ['Konflikt'],
      warnings: ['Warnung'],
    });

    renderBoard();

    fireEvent.click(screen.getByText('Drag create'));

    await waitFor(() => {
      expect(mockRequestOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          blockers: ['Konflikt'],
          warnings: ['Warnung'],
          doctorId: 'doc-1',
          position: 'Dienst A',
          date: '2026-04-13',
        }),
      );
    });
    expect(mockBulkCreate).not.toHaveBeenCalled();
  });
});
