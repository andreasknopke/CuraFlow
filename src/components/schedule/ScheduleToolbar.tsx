import {
  ChevronLeft,
  ChevronRight,
  Wand2,
  Loader2,
  Trash2,
  Eye,
  Download,
  Undo,
  ExternalLink,
  X,
  Layout,
  Calendar,
  LayoutList,
} from 'lucide-react';
import { format, addDays, startOfWeek, startOfMonth, addMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import WorkplaceConfigDialog from '@/components/settings/WorkplaceConfigDialog';
import ColorSettingsDialog from '@/components/settings/ColorSettingsDialog';
import SectionConfigDialog from '@/components/settings/SectionConfigDialog';
import { getWorkplaceCategoryNames } from '@/utils/workplaceCategoryUtils';

interface SectionRow {
  name: string;
  displayName?: string;
  timeslotId?: string | null;
  [key: string]: unknown;
}

interface Section {
  title: string;
  rows: (string | SectionRow)[];
  [key: string]: unknown;
}

interface SectionTab {
  id: string;
  sectionTitle: string;
  [key: string]: unknown;
}

interface PreviewShift {
  id?: number;
  date: string;
  position: string;
  doctor_id: number;
  isPreview?: boolean;
  [key: string]: unknown;
}

interface UndoAction {
  type: string;
  [key: string]: unknown;
}

interface SystemSettingItem {
  key: string;
  value?: string;
  [key: string]: unknown;
}

interface ScheduleToolbarProps {
  viewMode: string;
  setViewMode: (mode: string) => void;
  currentDate: Date;
  setCurrentDate: React.Dispatch<React.SetStateAction<Date>>;
  weekDays: Date[];
  undoStack: UndoAction[];
  onUndo: () => void;
  previewShifts: PreviewShift[] | null;
  onApplyPreview: () => void;
  onCancelPreview: () => void;
  isReadOnly: boolean;
  isGenerating: boolean;
  onAutoFill: (categories?: string[]) => void;
  getSectionName: (name: string) => string;
  systemSettings: SystemSettingItem[];
  isExporting: boolean;
  onExportExcel: () => void;
  currentWeekShiftsCount: number;
  onClearWeek: () => void;
  showSidebar: boolean;
  setShowSidebar: (show: boolean) => void;
  highlightMyName: boolean;
  setHighlightMyName: (highlight: boolean) => void;
  showInitialsOnly: boolean;
  setShowInitialsOnly: (show: boolean) => void;
  sortDoctorsAlphabetically: boolean;
  setSortDoctorsAlphabetically: (sort: boolean) => void;
  gridFontSize: number;
  setGridFontSize: (size: number) => void;
  hiddenRows: string[];
  setHiddenRows: React.Dispatch<React.SetStateAction<string[]>>;
  sections: Section[];
  availableSectionTabs: SectionTab[];
  activeSectionTabId: string;
  setActiveSectionTabId: (id: string) => void;
  canUseSplitView: boolean;
  isSplitViewEnabled: boolean;
  setIsSplitViewEnabled: (enabled: boolean) => void;
  onOpenSectionTabInSplitView: (id: string) => void;
  onOpenSectionTabInNewWindow: (id: string) => void;
  onCloseSectionTab: (id: string) => void;
}

/**
 * ScheduleToolbar — top action bar + section tabs for the schedule view.
 *
 * Extracted from ScheduleBoard to keep the container component focused
 * on grid rendering and drag-and-drop orchestration.
 */
export default function ScheduleToolbar({
  // Navigation
  viewMode,
  setViewMode,
  currentDate,
  setCurrentDate,
  weekDays,
  // Undo
  undoStack,
  onUndo,
  // Preview
  previewShifts,
  onApplyPreview,
  onCancelPreview,
  // Auto-fill
  isReadOnly,
  isGenerating,
  onAutoFill,
  getSectionName,
  systemSettings,
  // Export / clear
  isExporting,
  onExportExcel,
  currentWeekShiftsCount,
  onClearWeek,
  // Preferences (from useSchedulePreferences)
  showSidebar,
  setShowSidebar,
  highlightMyName,
  setHighlightMyName,
  showInitialsOnly,
  setShowInitialsOnly,
  sortDoctorsAlphabetically,
  setSortDoctorsAlphabetically,
  gridFontSize,
  setGridFontSize,
  hiddenRows,
  setHiddenRows,
  // Sections / rows
  sections,
  // Section tabs
  availableSectionTabs,
  activeSectionTabId,
  setActiveSectionTabId,
  canUseSplitView,
  isSplitViewEnabled,
  setIsSplitViewEnabled,
  onOpenSectionTabInSplitView,
  onOpenSectionTabInNewWindow,
  onCloseSectionTab,
}: ScheduleToolbarProps) {
  return (
    <>
      {/* ── Action bar ── */}
      <div className="flex flex-wrap gap-2 items-center bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          {/* Undo */}
          <Button
            variant="outline"
            size="icon"
            onClick={onUndo}
            disabled={undoStack.length === 0}
            title="Rückgängig (Ctrl+Z)"
            className={`h-9 w-9 ${undoStack.length > 0 ? 'text-indigo-600 border-indigo-200 hover:bg-indigo-50' : 'opacity-50'}`}
          >
            <Undo className="w-4 h-4" />
          </Button>

          {/* Today */}
          <Button
            variant="outline"
            onClick={() =>
              setCurrentDate(
                viewMode === 'week'
                  ? startOfWeek(new Date(), { weekStartsOn: 1 })
                  : viewMode === 'month'
                    ? startOfMonth(new Date())
                    : new Date(),
              )
            }
            className="h-9"
            disabled={!!previewShifts}
            title={previewShifts ? 'Navigation im Preview-Modus gesperrt' : undefined}
          >
            Heute
          </Button>

          {/* Date navigation */}
          <div className="flex items-center bg-slate-100 rounded-md p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!!previewShifts}
              onClick={() =>
                setCurrentDate((d) =>
                  viewMode === 'week'
                    ? addDays(d, -7)
                    : viewMode === 'month'
                      ? addMonths(d, -1)
                      : addDays(d, -1),
                )
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 sm:px-4 font-medium w-[180px] sm:w-[280px] text-center block truncate text-sm">
              {viewMode === 'week'
                ? `${format(weekDays[0], 'd. MMM', { locale: de })} - ${format(weekDays[6], 'd. MMM', { locale: de })}`
                : viewMode === 'month'
                  ? format(currentDate, 'MMMM yyyy', { locale: de })
                  : format(currentDate, 'EEE, d. MMM yyyy', { locale: de })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!!previewShifts}
              onClick={() =>
                setCurrentDate((d) =>
                  viewMode === 'week'
                    ? addDays(d, 7)
                    : viewMode === 'month'
                      ? addMonths(d, 1)
                      : addDays(d, 1),
                )
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* View mode selector */}
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              disabled={!!previewShifts}
              onClick={() => {
                setViewMode('month');
                setCurrentDate((d) => startOfMonth(d));
              }}
              className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${previewShifts ? 'opacity-50 cursor-not-allowed' : ''} ${viewMode === 'month' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Layout className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Monat</span>
            </button>
            <button
              disabled={!!previewShifts}
              onClick={() => {
                setViewMode('week');
                setCurrentDate((d) => startOfWeek(d, { weekStartsOn: 1 }));
              }}
              className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${previewShifts ? 'opacity-50 cursor-not-allowed' : ''} ${viewMode === 'week' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Calendar className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Woche</span>
            </button>
            <button
              disabled={!!previewShifts}
              onClick={() => setViewMode('day')}
              className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${previewShifts ? 'opacity-50 cursor-not-allowed' : ''} ${viewMode === 'day' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutList className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Tag</span>
            </button>
          </div>

          {/* Preview indicator */}
          {previewShifts && (
            <div className="flex items-center bg-indigo-50 text-indigo-700 px-3 py-1 rounded-md border border-indigo-200">
              <Wand2 className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium mr-3">{previewShifts.length} Vorschläge</span>
              <Button
                size="sm"
                onClick={onApplyPreview}
                className="bg-indigo-600 hover:bg-indigo-700 text-white h-7 mr-2"
              >
                Alle übernehmen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelPreview}
                className="h-7 hover:bg-indigo-100 hover:text-indigo-800"
              >
                Verwerfen
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {/* Auto-fill */}
          {!isReadOnly && !previewShifts && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline ml-1">Auto-Fill</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Vorschläge generieren</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAutoFill()}>Alle Kategorien</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAutoFill(['Rotationen'])}>
                  Nur {getSectionName('Rotationen')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAutoFill(['Dienste'])}>
                  Nur {getSectionName('Dienste')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAutoFill(['Demonstrationen & Konsile'])}>
                  Nur {getSectionName('Demonstrationen & Konsile')}
                </DropdownMenuItem>
                {getWorkplaceCategoryNames(systemSettings).map((name) => (
                  <DropdownMenuItem key={name} onClick={() => onAutoFill([name])}>
                    Nur {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Export */}
          <Button
            variant="outline"
            size="sm"
            onClick={onExportExcel}
            disabled={isExporting}
            title="Export nach Excel"
            className="h-9"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span className="hidden sm:inline ml-1">Export</span>
          </Button>

          {/* Clear week */}
          {currentWeekShiftsCount > 0 && !isReadOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearWeek}
              className="text-red-500 hover:text-red-700 hover:bg-red-50 h-9"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline ml-1">Leeren</span>
            </Button>
          )}

          {/* Config dialogs */}
          {!isReadOnly && (
            <>
              <WorkplaceConfigDialog />
              <ColorSettingsDialog />
            </>
          )}
          <SectionConfigDialog />

          {/* View settings */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" title="Ansicht anpassen">
                <Eye className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Ansicht</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={showSidebar} onCheckedChange={setShowSidebar}>
                Team Leiste anzeigen
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={highlightMyName}
                onCheckedChange={setHighlightMyName}
              >
                Eigenen Namen hervorheben
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showInitialsOnly}
                onCheckedChange={setShowInitialsOnly}
              >
                Nur Kürzel
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortDoctorsAlphabetically}
                onCheckedChange={setSortDoctorsAlphabetically}
              >
                Mitarbeiter alphabetisch sortieren
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />

              <DropdownMenuLabel className="flex justify-between items-center">
                <span>Schriftgröße</span>
                <span className="text-xs font-normal text-slate-500">{gridFontSize}px</span>
              </DropdownMenuLabel>
              <div className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="range"
                  min="10"
                  max="24"
                  step="1"
                  value={gridFontSize}
                  onChange={(e) => setGridFontSize(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Zeilen verwalten</DropdownMenuLabel>
              <ScrollArea className="h-[300px]">
                {sections
                  .flatMap((s) => s.rows)
                  .map((row, idx) => {
                    const rowObj = typeof row === 'string' ? { name: row, displayName: row } : row;
                    const rowName = rowObj.name;
                    const rowDisplayName = rowObj.displayName || rowName;
                    const rowKey = rowObj.timeslotId
                      ? `${rowName}-${rowObj.timeslotId}`
                      : `${rowName}-${idx}`;
                    return (
                      <DropdownMenuCheckboxItem
                        key={rowKey}
                        checked={!hiddenRows.includes(rowName)}
                        onCheckedChange={(checked) => {
                          setHiddenRows((prev) =>
                            checked ? prev.filter((r) => r !== rowName) : [...prev, rowName],
                          );
                        }}
                      >
                        {rowDisplayName}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Section tabs ── */}
      {availableSectionTabs.length > 0 && (
        <div className="bg-white p-2 rounded-lg shadow-sm border border-slate-200 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSectionTabId('main')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${activeSectionTabId === 'main' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Hauptplan
          </button>
          {availableSectionTabs.map((tab) => {
            const isActive = activeSectionTabId === tab.id;
            return (
              <div
                key={tab.id}
                className={`flex items-center rounded-md border transition-colors ${isActive ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}
              >
                <button
                  onClick={() => {
                    if (canUseSplitView && isSplitViewEnabled) {
                      onOpenSectionTabInSplitView(tab.id);
                      return;
                    }
                    setActiveSectionTabId(tab.id);
                  }}
                  className={`px-3 py-1.5 text-sm font-medium whitespace-nowrap ${isActive ? 'text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {getSectionName(tab.sectionTitle)}
                </button>
                <button
                  onClick={() => onOpenSectionTabInNewWindow(tab.id)}
                  className="px-2 py-1.5 text-slate-400 hover:text-indigo-600"
                  title="In separatem Fenster öffnen"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                {canUseSplitView && (
                  <button
                    onClick={() => onOpenSectionTabInSplitView(tab.id)}
                    className="px-2 py-1.5 text-slate-400 hover:text-indigo-600"
                    title="Im Split-View öffnen"
                  >
                    <Layout className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onCloseSectionTab(tab.id)}
                  className="px-2 py-1.5 text-slate-400 hover:text-red-500"
                  title="Reiter schließen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {canUseSplitView && isSplitViewEnabled && (
            <button
              onClick={() => setIsSplitViewEnabled(false)}
              className="px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100"
              title="Split-View schließen"
            >
              Split-View beenden
            </button>
          )}
        </div>
      )}
    </>
  );
}
