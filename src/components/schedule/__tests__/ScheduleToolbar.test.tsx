// @ts-nocheck
import { startOfMonth, startOfWeek } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/settings/WorkplaceConfigDialog', () => ({
  default: () => <div data-testid="workplace-config-dialog" />,
}));

vi.mock('@/components/settings/ColorSettingsDialog', () => ({
  default: () => <div data-testid="color-settings-dialog" />,
}));

vi.mock('@/components/settings/SectionConfigDialog', () => ({
  default: () => <div data-testid="section-config-dialog" />,
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }) => <div className={className}>{children}</div>,
}));

vi.mock('@/utils/workplaceCategoryUtils', () => ({
  getWorkplaceCategoryNames: () => ['Spezialbereich'],
}));

import ScheduleToolbar from '../ScheduleToolbar';

const createProps = (overrides = {}) => ({
  viewMode: 'week',
  setViewMode: vi.fn(),
  currentDate: new Date('2026-04-15T10:00:00.000Z'),
  setCurrentDate: vi.fn(),
  weekDays: Array.from(
    { length: 7 },
    (_, index) => new Date(`2026-04-${14 + index}T00:00:00.000Z`),
  ),
  undoStack: [],
  onUndo: vi.fn(),
  previewShifts: null,
  onApplyPreview: vi.fn(),
  onCancelPreview: vi.fn(),
  isReadOnly: false,
  isGenerating: false,
  onAutoFill: vi.fn(),
  getSectionName: (name) => name,
  systemSettings: [],
  isExporting: false,
  onExportExcel: vi.fn(),
  currentWeekShiftsCount: 0,
  onClearWeek: vi.fn(),
  showSidebar: true,
  setShowSidebar: vi.fn(),
  highlightMyName: false,
  setHighlightMyName: vi.fn(),
  showInitialsOnly: false,
  setShowInitialsOnly: vi.fn(),
  sortDoctorsAlphabetically: false,
  setSortDoctorsAlphabetically: vi.fn(),
  gridFontSize: 14,
  setGridFontSize: vi.fn(),
  hiddenRows: [],
  setHiddenRows: vi.fn(),
  sections: [{ rows: ['Dienst A', 'Dienst B'] }],
  availableSectionTabs: [],
  activeSectionTabId: 'main',
  setActiveSectionTabId: vi.fn(),
  canUseSplitView: false,
  isSplitViewEnabled: false,
  setIsSplitViewEnabled: vi.fn(),
  onOpenSectionTabInSplitView: vi.fn(),
  onOpenSectionTabInNewWindow: vi.fn(),
  onCloseSectionTab: vi.fn(),
  ...overrides,
});

describe('ScheduleToolbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates view mode and date navigation helpers consistently', () => {
    const props = createProps();

    render(<ScheduleToolbar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /monat/i }));
    expect(props.setViewMode).toHaveBeenCalledWith('month');
    const monthUpdater = props.setCurrentDate.mock.calls.at(-1)[0];
    expect(monthUpdater(new Date('2026-04-18T08:00:00.000Z')).toISOString()).toBe(
      startOfMonth(new Date('2026-04-18T08:00:00.000Z')).toISOString(),
    );

    fireEvent.click(screen.getByRole('button', { name: /woche/i }));
    expect(props.setViewMode).toHaveBeenCalledWith('week');
    const weekUpdater = props.setCurrentDate.mock.calls.at(-1)[0];
    expect(weekUpdater(new Date('2026-04-18T08:00:00.000Z')).toISOString()).toBe(
      startOfWeek(new Date('2026-04-18T08:00:00.000Z'), { weekStartsOn: 1 }).toISOString(),
    );

    fireEvent.click(screen.getByRole('button', { name: /heute/i }));
    expect(props.setCurrentDate).toHaveBeenLastCalledWith(
      startOfWeek(new Date('2026-04-15T10:30:00.000Z'), { weekStartsOn: 1 }),
    );
  });

  it('locks navigation during preview and exposes preview actions', () => {
    const props = createProps({
      previewShifts: [{ id: 'p1' }, { id: 'p2' }],
    });

    render(<ScheduleToolbar {...props} />);

    expect(screen.getByRole('button', { name: /heute/i })).toBeDisabled();
    expect(screen.getByText('2 Vorschläge')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /alle übernehmen/i }));
    fireEvent.click(screen.getByRole('button', { name: /verwerfen/i }));

    expect(props.onApplyPreview).toHaveBeenCalledTimes(1);
    expect(props.onCancelPreview).toHaveBeenCalledTimes(1);
  });

  it('routes section tab actions to the correct handlers in normal and split modes', () => {
    const props = createProps({
      availableSectionTabs: [{ id: 'dienste', sectionTitle: 'Dienste' }],
      canUseSplitView: true,
    });

    const { rerender } = render(<ScheduleToolbar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /hauptplan/i }));
    expect(props.setActiveSectionTabId).toHaveBeenCalledWith('main');

    fireEvent.click(screen.getByRole('button', { name: 'Dienste' }));
    expect(props.setActiveSectionTabId).toHaveBeenCalledWith('dienste');

    fireEvent.click(screen.getByTitle('In separatem Fenster öffnen'));
    fireEvent.click(screen.getByTitle('Im Split-View öffnen'));
    fireEvent.click(screen.getByTitle('Reiter schließen'));

    expect(props.onOpenSectionTabInNewWindow).toHaveBeenCalledWith('dienste');
    expect(props.onOpenSectionTabInSplitView).toHaveBeenCalledWith('dienste');
    expect(props.onCloseSectionTab).toHaveBeenCalledWith('dienste');

    const splitProps = createProps({
      ...props,
      availableSectionTabs: [{ id: 'dienste', sectionTitle: 'Dienste' }],
      canUseSplitView: true,
      isSplitViewEnabled: true,
    });
    rerender(<ScheduleToolbar {...splitProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dienste' }));
    expect(splitProps.onOpenSectionTabInSplitView).toHaveBeenCalledWith('dienste');

    fireEvent.click(screen.getByRole('button', { name: /split-view beenden/i }));
    expect(splitProps.setIsSplitViewEnabled).toHaveBeenCalledWith(false);
  });
});
