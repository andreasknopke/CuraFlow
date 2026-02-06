import React, { useState, useMemo, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { format, addDays, startOfWeek, isSameDay, isWeekend, startOfMonth, endOfMonth, addMonths, isValid } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ChevronDown, Wand2, Loader2, Trash2, Eye, EyeOff, Layout, GripHorizontal, Calendar, LayoutList, Plus, StickyNote, AlertTriangle, Download, Undo } from 'lucide-react';
import { toast } from "sonner";
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, db, base44 } from "@/api/client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import DraggableDoctor from './DraggableDoctor';
import DraggableShift from './DraggableShift';
import DroppableCell from './DroppableCell';
import WorkplaceConfigDialog from '@/components/settings/WorkplaceConfigDialog';
import AIRulesDialog from './AIRulesDialog';
import ColorSettingsDialog, { DEFAULT_COLORS } from '@/components/settings/ColorSettingsDialog';
import FreeTextCell from './FreeTextCell';
import { useShiftValidation } from '@/components/validation/useShiftValidation';
import { useOverrideValidation } from '@/components/validation/useOverrideValidation';
import OverrideConfirmDialog from '@/components/validation/OverrideConfirmDialog';
// trackDbChange removed - MySQL mode doesn't use auto-backup
import { useHolidays } from '@/components/useHolidays';
import SectionConfigDialog, { useSectionConfig } from '@/components/settings/SectionConfigDialog';
import MobileScheduleView from './MobileScheduleView';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTeamRoles } from '@/components/settings/TeamRoleSettings';
// import VoiceControl from './VoiceControl';

const STATIC_SECTIONS = {
    "Anwesenheiten": {
        headerColor: "bg-indigo-100 text-indigo-900",
        rowColor: "bg-indigo-50/30",
        rows: ["Verfügbar"]
    },
    "Abwesenheiten": {
        headerColor: "bg-slate-200 text-slate-800",
        rowColor: "bg-slate-50/50",
        rows: ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"]
    },
    "Dienste": {
        headerColor: "bg-blue-100 text-blue-900",
        rowColor: "bg-blue-50/30",
        rows: [] // Dynamically loaded from workplaces
    },
    "Sonstiges": {
        headerColor: "bg-purple-100 text-purple-900",
        rowColor: "bg-purple-50/30",
        rows: ["Sonstiges"]
    }
};

const SECTION_CONFIG = {
    "Rotationen": {
        headerColor: "bg-emerald-100 text-emerald-900",
        rowColor: "bg-emerald-50/30",
    },
    "Demonstrationen & Konsile": {
        headerColor: "bg-amber-100 text-amber-900",
        rowColor: "bg-amber-50/30",
    }
};

export default function ScheduleBoard() {
  // const { isReadOnly } = useAuth(); // Removed duplicate destructuring
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'day'
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [undoStack, setUndoStack] = useState([]);

  const handleUndo = async () => {
      if (undoStack.length === 0) return;
      const item = undoStack[undoStack.length - 1];
      
      // Remove from stack immediately
      setUndoStack(prev => prev.slice(0, -1));

      const actions = Array.isArray(item) ? item : [item];

      try {
          for (const action of actions) {
              if (action.type === 'DELETE') {
                  await db.ShiftEntry.delete(action.id);
              } else if (action.type === 'CREATE') {
                  await db.ShiftEntry.create(action.data);
              } else if (action.type === 'UPDATE') {
                  await db.ShiftEntry.update(action.id, action.data);
              } else if (action.type === 'BULK_CREATE') {
                  await db.ShiftEntry.bulkCreate(action.data);
              } else if (action.type === 'BULK_DELETE') {
                  await Promise.all(action.ids.map(id => db.ShiftEntry.delete(id)));
              }
          }
          queryClient.invalidateQueries(['shifts']);
      } catch (e) {
          console.error("Undo failed", e);
          alert("Rückgängig fehlgeschlagen: " + e.message);
      }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Control') setIsCtrlPressed(true);
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
          e.preventDefault();
          handleUndo();
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Control') setIsCtrlPressed(false);
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
  }, [undoStack]);

  const { isReadOnly, user } = useAuth();

  // Load saved settings from user profile or localStorage fallback
  const [showSidebar, setShowSidebar] = useState(() => {
      if (user?.schedule_show_sidebar !== undefined) return user.schedule_show_sidebar;
      try {
          const saved = localStorage.getItem('radioplan_showSidebar');
          return saved ? JSON.parse(saved) : true;
      } catch (e) { return true; }
  });
  
  const [hiddenRows, setHiddenRows] = useState(() => {
      if (user?.schedule_hidden_rows && Array.isArray(user.schedule_hidden_rows)) return user.schedule_hidden_rows;
      try {
          const saved = localStorage.getItem('radioplan_hiddenRows');
          return saved ? JSON.parse(saved) : [];
      } catch (e) { return []; }
  });
  
  // Use dynamic holiday calculator instead of static MV functions
  const currentYear = useMemo(() => new Date(currentDate).getFullYear(), [currentDate]);
  const { isPublicHoliday, isSchoolHoliday } = useHolidays(currentYear);
  
  // User-specific section configuration
  const { getSectionName, getSectionOrder } = useSectionConfig();

  const [collapsedSections, setCollapsedSections] = useState(() => {
      // Try user prefs first, then localStorage as fallback (migration), then empty
      if (user?.collapsed_sections) return user.collapsed_sections;
      try {
          const saved = localStorage.getItem('radioplan_collapsedSections');
          return saved ? JSON.parse(saved) : [];
      } catch (e) { return []; }
  });

  const [highlightMyName, setHighlightMyName] = useState(() => {
      if (user?.highlight_my_name !== undefined) return user.highlight_my_name;
      try {
          const saved = localStorage.getItem('radioplan_highlightMyName');
          return saved ? JSON.parse(saved) : true;
      } catch (e) { return true; }
  });

  // Sync with user profile when it loads/updates
  useEffect(() => {
      if (user?.collapsed_sections && Array.isArray(user.collapsed_sections)) {
          setCollapsedSections(prev => {
              // Only update if significantly different to avoid overwriting local interactions during sync
              if (JSON.stringify(prev) !== JSON.stringify(user.collapsed_sections)) {
                  return user.collapsed_sections;
              }
              return prev;
          });
      }
      if (user?.highlight_my_name !== undefined) {
          setHighlightMyName(user.highlight_my_name);
      }
  }, [user]);

  useEffect(() => {
      localStorage.setItem('radioplan_highlightMyName', JSON.stringify(highlightMyName));
      if (user && user.highlight_my_name !== highlightMyName) {
          api.updateMe({ data: { highlight_my_name: highlightMyName } }).catch(e => console.error("Pref save failed", e));
      }
  }, [highlightMyName, user]);



  const [gridFontSize, setGridFontSize] = useState(() => {
      try {
          const saved = localStorage.getItem('radioplan_gridFontSize');
          return saved ? JSON.parse(saved) : 14;
      } catch (e) { return 14; }
  });

  // Sync with user profile when it loads/updates (for sidebar/hiddenRows)
  useEffect(() => {
      if (user?.schedule_show_sidebar !== undefined) {
          setShowSidebar(user.schedule_show_sidebar);
      }
      if (user?.schedule_hidden_rows && Array.isArray(user.schedule_hidden_rows)) {
          setHiddenRows(prev => {
              if (JSON.stringify(prev) !== JSON.stringify(user.schedule_hidden_rows)) {
                  return user.schedule_hidden_rows;
              }
              return prev;
          });
      }
  }, [user]);

  // Save settings on change
  useEffect(() => {
      localStorage.setItem('radioplan_showSidebar', JSON.stringify(showSidebar));
      if (user && user.schedule_show_sidebar !== showSidebar) {
          api.updateMe({ data: { schedule_show_sidebar: showSidebar } }).catch(e => console.error("Pref save failed", e));
      }
  }, [showSidebar, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_hiddenRows', JSON.stringify(hiddenRows));
      if (user && JSON.stringify(user.schedule_hidden_rows) !== JSON.stringify(hiddenRows)) {
          api.updateMe({ data: { schedule_hidden_rows: hiddenRows } }).catch(e => console.error("Pref save failed", e));
      }
  }, [hiddenRows, user]);

  useEffect(() => {
      localStorage.setItem('radioplan_collapsedSections', JSON.stringify(collapsedSections));
      
      // Persist to backend if user is logged in
      if (user) {
          // Debounce or direct? Direct is fine for clicks. 
          // We need to be careful not to create a loop with the user effect above.
          // The user effect checks for equality, so it should be fine.
          // However, updateMe triggers user update which triggers effect.
          // We should only updateMe if the value is different from what's in user object currently.
          if (JSON.stringify(user.collapsed_sections) !== JSON.stringify(collapsedSections)) {
             api.updateMe({ data: { collapsed_sections: collapsedSections } }).catch(e => console.error("Pref save failed", e));
          }
      }
  }, [collapsedSections, user]);

  // State für eingeklappte Timeslot-Gruppen (Arbeitsplatz-Namen)
  const [collapsedTimeslotGroups, setCollapsedTimeslotGroups] = useState(() => {
      try {
          const saved = localStorage.getItem('radioplan_collapsedTimeslotGroups');
          return saved ? JSON.parse(saved) : [];
      } catch {
          return [];
      }
  });

  useEffect(() => {
      localStorage.setItem('radioplan_collapsedTimeslotGroups', JSON.stringify(collapsedTimeslotGroups));
  }, [collapsedTimeslotGroups]);

  const toggleTimeslotGroup = (workplaceName) => {
      setCollapsedTimeslotGroups(prev => 
          prev.includes(workplaceName) 
              ? prev.filter(n => n !== workplaceName) 
              : [...prev, workplaceName]
      );
  };

  useEffect(() => {
      localStorage.setItem('radioplan_gridFontSize', JSON.stringify(gridFontSize));
  }, [gridFontSize]);
  const [previewShifts, setPreviewShifts] = useState(null);
  const [draggingDoctorId, setDraggingDoctorId] = useState(null);
  const [draggingShiftId, setDraggingShiftId] = useState(null);
  const [isDraggingFromGrid, setIsDraggingFromGrid] = useState(false);

  const queryClient = useQueryClient();

  // Dynamische Rollenprioritäten aus DB laden
  const { rolePriority } = useTeamRoles();

  // Fetch data with optimized caching
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    select: (data) => [...data].sort((a, b) => {
      const roleDiff = (rolePriority[a.role] ?? 99) - (rolePriority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      return (a.order || 0) - (b.order || 0);
    }),
  });

  const updateDoctorMutation = useMutation({
    mutationFn: ({ id, data }) => db.Doctor.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['doctors']),
  });

  const fetchRange = useMemo(() => {
      if (!isValid(currentDate)) {
          console.warn("Invalid currentDate detected, using fallback range");
          return { start: format(new Date(), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') };
      }
      const start = startOfMonth(addMonths(currentDate, -1));
      const end = endOfMonth(addMonths(currentDate, 1));
      return {
          start: format(start, 'yyyy-MM-dd'),
          end: format(end, 'yyyy-MM-dd')
      };
  }, [currentDate]);

  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', fetchRange.start, fetchRange.end],
    queryFn: () => db.ShiftEntry.filter({
        date: { $gte: fetchRange.start, $lte: fetchRange.end }
    }, null, 5000),
    keepPreviousData: true,
    staleTime: 30 * 1000, // 30 seconds cache
  });

  const { data: wishes = [] } = useQuery({
    queryKey: ['wishes', fetchRange.start, fetchRange.end],
    queryFn: () => db.WishRequest.filter({
        date: { $gte: fetchRange.start, $lte: fetchRange.end }
    }),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    keepPreviousData: true,
  });

  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => db.Workplace.list(null, 1000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Timeslots für Zeitfenster-Feature
  const { data: workplaceTimeslots = [] } = useQuery({
    queryKey: ['workplaceTimeslots'],
    queryFn: () => db.WorkplaceTimeslot.list(null, 1000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: systemSettings = [] } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: () => db.SystemSetting.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const sections = useMemo(() => {
      // Get custom categories from settings
      const customCategoriesSetting = systemSettings.find(s => s.key === 'workplace_categories');
      let customCategories = [];
      if (customCategoriesSetting?.value) {
          try {
              customCategories = JSON.parse(customCategoriesSetting.value);
          } catch { }
      }

      // Hilfsfunktion: Erstellt Zeilen für Arbeitsplätze (mit Timeslot-Expansion)
      const createRowsForCategory = (categoryName) => {
          const categoryWorkplaces = workplaces
              .filter(w => w.category === categoryName)
              .sort((a, b) => (a.order || 0) - (b.order || 0));
          
          const rows = [];
          for (const wp of categoryWorkplaces) {
              if (wp.timeslots_enabled) {
                  // Arbeitsplatz mit Timeslots - erstelle Sub-Zeilen
                  const wpTimeslots = workplaceTimeslots
                      .filter(t => t.workplace_id === wp.id)
                      .sort((a, b) => (a.order || 0) - (b.order || 0));
                  
                  if (wpTimeslots.length === 1) {
                      // NUR 1 Timeslot: Verhalte dich wie normaler Workplace
                      // Mitarbeiter werden automatisch in den ersten Timeslot eingetragen
                      rows.push({ 
                          name: wp.name, 
                          displayName: wp.name, 
                          timeslotId: null, 
                          isTimeslotRow: false, 
                          isTimeslotGroupHeader: false,
                          // Speichere den einzigen Timeslot für automatische Zuweisung
                          singleTimeslotId: wpTimeslots[0].id,
                          singleTimeslotLabel: wpTimeslots[0].label
                      });
                  } else if (wpTimeslots.length > 1) {
                      // Mehr als 1 Timeslot: Expandierbare Gruppe
                      // Zuerst: Header-Zeile für die Gruppe (zum Ein-/Ausklappen)
                      rows.push({
                          name: wp.name,
                          displayName: wp.name,
                          timeslotId: null,
                          timeslotLabel: null,
                          isTimeslotRow: false,
                          isTimeslotGroupHeader: true,
                          timeslotCount: wpTimeslots.length,
                          allTimeslotIds: wpTimeslots.map(t => t.id),
                          workplaceId: wp.id  // Für spätere Prüfung auf Altdaten
                      });
                      
                      // "Nicht zugewiesen" Zeile wird immer eingefügt, aber später gefiltert
                      // wenn keine Altdaten vorhanden sind
                      rows.push({
                          name: wp.name,
                          displayName: `${wp.name} (Nicht zugewiesen)`,
                          timeslotId: '__unassigned__',
                          timeslotLabel: 'Nicht zugewiesen',
                          isTimeslotRow: true,
                          isTimeslotGroupHeader: false,
                          isUnassignedRow: true,
                          parentWorkplace: wp.name
                      });
                      
                      // Dann: Eine Zeile pro Timeslot (werden nur angezeigt wenn ausgeklappt)
                      for (const ts of wpTimeslots) {
                          rows.push({
                              name: wp.name,
                              displayName: `${wp.name} (${ts.label})`,
                              timeslotId: ts.id,
                              timeslotLabel: ts.label,
                              isTimeslotRow: true,
                              isTimeslotGroupHeader: false,
                              startTime: ts.start_time,
                              endTime: ts.end_time,
                              parentWorkplace: wp.name
                          });
                      }
                  } else {
                      // Timeslots aktiviert aber noch keine definiert
                      rows.push({ name: wp.name, displayName: wp.name, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false });
                  }
              } else {
                  // Standard: Eine Zeile
                  rows.push({ name: wp.name, displayName: wp.name, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false });
              }
          }
          return rows;
      };

      const dynamicRows = {
          "Dienste": createRowsForCategory("Dienste"),
          "Rotationen": createRowsForCategory("Rotationen"),
          "Demonstrationen & Konsile": createRowsForCategory("Demonstrationen & Konsile")
      };

      // Add custom categories to dynamicRows
      for (const cat of customCategories) {
          dynamicRows[cat] = createRowsForCategory(cat);
      }

      // Für statische Sections: Einfache String-zu-Objekt Konvertierung
      const staticRowsToObjects = (rows) => rows.map(name => ({ 
          name, displayName: name, timeslotId: null, isTimeslotRow: false 
      }));

      // Find Orphaned Positions - jetzt mit Namen aus dynamicRows
      const allKnownPositions = new Set([
          ...STATIC_SECTIONS["Anwesenheiten"].rows,
          ...STATIC_SECTIONS["Abwesenheiten"].rows,
          ...dynamicRows["Dienste"].map(r => r.name),
          ...dynamicRows["Rotationen"].map(r => r.name),
          ...dynamicRows["Demonstrationen & Konsile"].map(r => r.name),
          ...customCategories.flatMap(cat => (dynamicRows[cat] || []).map(r => r.name)),
          ...STATIC_SECTIONS["Sonstiges"].rows
      ]);

      const currentViewShifts = previewShifts 
          ? [...allShifts, ...previewShifts]
          : allShifts;

      // We only care about shifts in the current view range roughly, but better to check all loaded shifts
      const orphanedPositions = Array.from(new Set(
          currentViewShifts
              .map(s => s.position)
              .filter(p => !allKnownPositions.has(p))
      )).sort();

      // Build sections with default order
      const defaultSections = [
          { title: "Abwesenheiten", ...STATIC_SECTIONS["Abwesenheiten"], rows: staticRowsToObjects(STATIC_SECTIONS["Abwesenheiten"].rows) },
          { 
              title: "Dienste", 
              ...STATIC_SECTIONS["Dienste"],
              rows: dynamicRows["Dienste"]
          },
          { 
              title: "Rotationen", 
              ...SECTION_CONFIG["Rotationen"], 
              rows: dynamicRows["Rotationen"] 
          },
          { title: "Anwesenheiten", ...STATIC_SECTIONS["Anwesenheiten"], rows: staticRowsToObjects(STATIC_SECTIONS["Anwesenheiten"].rows) },
          { 
              title: "Demonstrationen & Konsile", 
              ...SECTION_CONFIG["Demonstrationen & Konsile"], 
              rows: dynamicRows["Demonstrationen & Konsile"] 
          },
          // Add custom categories dynamically
          ...customCategories.map(cat => ({
              title: cat,
              headerColor: "bg-indigo-100 text-indigo-900",
              rowColor: "bg-indigo-50/30",
              rows: dynamicRows[cat] || []
          })),
          { title: "Sonstiges", ...STATIC_SECTIONS["Sonstiges"], rows: staticRowsToObjects(STATIC_SECTIONS["Sonstiges"].rows) }
      ];
      
      // Apply user-specific order
      const orderedTitles = getSectionOrder();
      const result = orderedTitles
          .map(title => defaultSections.find(s => s.title === title))
          .filter(Boolean);
      
      // Add any sections that are new and not yet in the order
      for (const section of defaultSections) {
          if (!result.find(r => r.title === section.title)) {
              // Insert before "Sonstiges" if possible, otherwise at end
              const sonstigesIdx = result.findIndex(r => r.title === "Sonstiges");
              if (sonstigesIdx >= 0) {
                  result.splice(sonstigesIdx, 0, section);
              } else {
                  result.push(section);
              }
          }
      }

      if (orphanedPositions.length > 0) {
          result.push({
              title: "Archiv / Unbekannt",
              headerColor: "bg-red-100 text-red-900",
              rowColor: "bg-red-50/30",
              rows: staticRowsToObjects(orphanedPositions)
          });
      }

      return result;
  }, [workplaces, workplaceTimeslots, allShifts, previewShifts, getSectionOrder, systemSettings]);

  const { data: trainingRotations = [] } = useQuery({
    queryKey: ['trainingRotations'],
    queryFn: () => db.TrainingRotation.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: scheduleRules = [] } = useQuery({
    queryKey: ['scheduleRules'],
    queryFn: () => db.ScheduleRule.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: colorSettings = [], isLoading: isLoadingColors } = useQuery({
    queryKey: ['colorSettings'],
    queryFn: () => db.ColorSetting.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: scheduleNotes = [] } = useQuery({
    queryKey: ['scheduleNotes'],
    queryFn: () => db.ScheduleNote.list(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const { validate, validateWithUI, shouldCreateAutoFrei, findAutoFreiToCleanup, isAutoOffPosition } = useShiftValidation(allShifts, { workplaces, timeslots: workplaceTimeslots });

  // Override-Validierung mit Dialog
  const {
      overrideDialog,
      requestOverride,
      confirmOverride,
      cancelOverride,
      setOverrideDialogOpen
  } = useOverrideValidation({ user, doctors });

  // Hilfsfunktion: Timeslots für einen Arbeitsplatz
  const getTimeslotsForWorkplace = useMemo(() => (workplaceName) => {
      const workplace = workplaces.find(w => w.name === workplaceName);
      if (!workplace?.timeslots_enabled) return [];
      return workplaceTimeslots
          .filter(t => t.workplace_id === workplace.id)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [workplaces, workplaceTimeslots]);

  // Prüft ob ein Arbeitsplatz Timeslots hat
  const workplaceHasTimeslots = useMemo(() => (workplaceName) => {
      const workplace = workplaces.find(w => w.name === workplaceName);
      return workplace?.timeslots_enabled === true && 
             workplaceTimeslots.some(t => t.workplace_id === workplace?.id);
  }, [workplaces, workplaceTimeslots]);

  const getRoleColor = useMemo(() => (role) => {
      const setting = colorSettings.find(s => s.name === role && s.category === 'role');
      if (setting) return { backgroundColor: setting.bg_color, color: setting.text_color };
      if (DEFAULT_COLORS.roles[role]) return { backgroundColor: DEFAULT_COLORS.roles[role].bg, color: DEFAULT_COLORS.roles[role].text };
      return { backgroundColor: '#f3f4f6', color: '#1f2937' }; // Default gray
  }, [colorSettings]);

  // Helper to mix tailwind default and custom style
  const getSectionStyle = useMemo(() => (sectionTitle) => {
      const setting = colorSettings.find(s => s.name === sectionTitle && s.category === 'section');
      if (setting) {
          return { 
              header: { backgroundColor: setting.bg_color, color: setting.text_color },
              row: { backgroundColor: setting.bg_color + '4D' } 
          };
      }
      return null;
  }, [colorSettings]);

  const getRowStyle = useMemo(() => (rowName, sectionStyle) => {
      // Check for specific position color
      const setting = colorSettings.find(s => s.name === rowName && s.category === 'position');
      if (setting) {
          return { 
              backgroundColor: setting.bg_color + '33', // ~20% opacity
              color: setting.text_color
          };
      }
      // Fallback to section style
      if (sectionStyle) {
          return { backgroundColor: sectionStyle.row.backgroundColor };
      }
      return {};
  }, [colorSettings]);

  const createShiftMutation = useMutation({
    mutationFn: async (data) => {
        const shift = await db.ShiftEntry.create(data);

        // Notify user if admin created it
        if (user?.role === 'admin' && data.doctor_id) {
            const doc = doctors.find(d => d.id === data.doctor_id);
            if (doc && doc.id !== user.doctor_id) {
                db.ShiftNotification.create({
                    doctor_id: data.doctor_id,
                    date: data.date,
                    type: 'create',
                    message: `Neuer Dienst eingetragen: ${data.position}`,
                    acknowledged: false
                });
            }
        }

        // Check for matching wish and auto-approve
        const matchingWish = wishes.find(w => 
            w.doctor_id === data.doctor_id && 
            w.date === data.date && 
            w.type === 'service' && 
            w.status === 'pending' &&
            (!w.position || w.position === data.position)
        );

        if (matchingWish) {
            await db.WishRequest.update(matchingWish.id, { 
                status: 'approved',
                user_viewed: false,
                admin_comment: 'Automatisch genehmigt durch Diensteinteilung'
            });
        }

        return shift;
    },
    onMutate: async (newData) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
        
        const tempShift = { ...newData, id: `temp-${Date.now()}` };
        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => [...old, tempShift]);
        }
        return { previousShifts };
    },
    onSuccess: (data, newData, context) => {
        // trackDbChange(); // Disabled - MySQL mode
        setUndoStack(prev => [...prev, { type: 'DELETE', id: data.id }]);
        // Only invalidate shifts in affected range
        queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
    },
    onError: (error, newData, context) => {
        console.error('DEBUG: Create Mutation Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        alert(`Fehler beim Erstellen: ${error.message}`);
    }
  });

  const bulkCreateShiftsMutation = useMutation({
    mutationFn: async (shiftsData) => {
        const createdShifts = await db.ShiftEntry.bulkCreate(shiftsData);
        
        // Side Effects handling for each created shift
        // Note: bulkCreate returns the created objects
        if (Array.isArray(createdShifts)) {
            for (const shift of createdShifts) {
                // Notifications
                if (user?.role === 'admin' && shift.doctor_id) {
                    const doc = doctors.find(d => d.id === shift.doctor_id);
                    if (doc && doc.id !== user.doctor_id) {
                        // Fire and forget notification to avoid slowing down
                        db.ShiftNotification.create({
                            doctor_id: shift.doctor_id,
                            date: shift.date,
                            type: 'create',
                            message: `Neuer Dienst eingetragen: ${shift.position}`,
                            acknowledged: false
                        }).catch(console.error);
                    }
                }
                
                // Wish Approval
                const matchingWish = wishes.find(w => 
                    w.doctor_id === shift.doctor_id && 
                    w.date === shift.date && 
                    w.type === 'service' && 
                    w.status === 'pending' &&
                    (!w.position || w.position === shift.position)
                );

                if (matchingWish) {
                    await db.WishRequest.update(matchingWish.id, { 
                        status: 'approved',
                        user_viewed: false,
                        admin_comment: 'Automatisch genehmigt durch Diensteinteilung'
                    }).catch(console.error);
                }
            }
        }
        return createdShifts;
    },
    onMutate: async (newShifts) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
        
        const tempShifts = newShifts.map((s, i) => ({ ...s, id: `temp-bulk-${Date.now()}-${i}` }));
        
        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => [...old, ...tempShifts]);
        }
        return { previousShifts };
    },
    onSuccess: (data, variables, context) => {
        // trackDbChange(data.length); // Disabled - MySQL mode
        if (Array.isArray(data)) {
             setUndoStack(prev => [...prev, { type: 'BULK_DELETE', ids: data.map(s => s.id) }]);
        }
        queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
    },
    onError: (error, variables, context) => {
        console.error('DEBUG: Bulk Create Failed', error);
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        alert(`Fehler beim Erstellen (Bulk): ${error.message}`);
    }
  });

  const updateShiftMutation = useMutation({
    mutationFn: async ({ id, data }) => {
        const shift = await db.ShiftEntry.update(id, data);

        // Check for matching wish and auto-approve
        // Note: data.doctor_id might not be present in update if only position changed, 
        // or data.position/date might not be present. We need to merge with existing.
        const fullShift = { ...allShifts.find(s => s.id === id), ...data };

        const matchingWish = wishes.find(w => 
            w.doctor_id === fullShift.doctor_id && 
            w.date === fullShift.date && 
            w.type === 'service' && 
            w.status === 'pending' &&
            (!w.position || w.position === fullShift.position)
        );

        if (matchingWish) {
             await db.WishRequest.update(matchingWish.id, { 
                status: 'approved',
                user_viewed: false,
                admin_comment: 'Automatisch genehmigt durch Diensteinteilung'
            });
        }

        return shift;
    },
    onMutate: async ({ id, data }) => {
        // Cancel any outgoing refetches to avoid overwriting our optimistic update
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        
        // Snapshot the previous value for rollback
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);
        const oldShift = previousShifts?.find(s => s.id === id);
        
        // Optimistically update to the new value immediately
        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => 
                old.map(s => s.id === id ? { ...s, ...data } : s)
            );
        }
        
        return { previousShifts, oldShift, newData: data };
    },
    onSuccess: (data, { id, data: inputData }, context) => {
        // trackDbChange(); // Disabled - MySQL mode
        if (context.oldShift) {
            const { id: _, created_date, updated_date, created_by, ...oldData } = context.oldShift;
            setUndoStack(prev => [...prev, { type: 'UPDATE', id, data: oldData }]);

            // Notify user if admin updated it
            if (user?.role === 'admin') {
                const newShift = { ...context.oldShift, ...inputData };
                const docId = newShift.doctor_id;
                
                if (context.oldShift.doctor_id !== docId) {
                    // Notify old doctor
                    if (context.oldShift.doctor_id !== user.doctor_id) {
                        db.ShiftNotification.create({
                            doctor_id: context.oldShift.doctor_id,
                            date: context.oldShift.date,
                            type: 'delete',
                            message: `Dienst entfernt: ${context.oldShift.position}`,
                            acknowledged: false
                        });
                    }
                    // Notify new doctor
                    if (docId && docId !== user.doctor_id) {
                        db.ShiftNotification.create({
                            doctor_id: docId,
                            date: newShift.date,
                            type: 'create',
                            message: `Neuer Dienst zugewiesen: ${newShift.position}`,
                            acknowledged: false
                        });
                    }
                } else if (docId && docId !== user.doctor_id) {
                    // Same doctor, details changed
                    const changes = [];
                    if (context.oldShift.date !== newShift.date) changes.push(`Datum: ${format(new Date(context.oldShift.date), 'dd.MM')} -> ${format(new Date(newShift.date), 'dd.MM')}`);
                    if (context.oldShift.position !== newShift.position) changes.push(`Position: ${context.oldShift.position} -> ${newShift.position}`);
                    
                    if (changes.length > 0) {
                        db.ShiftNotification.create({
                            doctor_id: docId,
                            date: newShift.date,
                            type: 'update',
                            message: `Dienständerung: ${changes.join(', ')}`,
                            acknowledged: false
                        });
                    }
                }
            }
        }
        // Debounced invalidation
        setTimeout(() => {
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
        }, 100);
    },
    onError: (error, variables, context) => {
        console.error('DEBUG: Update Mutation Failed', error);
        // Rollback to the previous value on error
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
    });

  // Dedicated mutations for automatic background operations
  const createAutoFreiMutation = useMutation({
    mutationFn: (data) => db.ShiftEntry.create(data),
    onSuccess: (data) => {
        setUndoStack(prev => {
            const undoAction = { type: 'DELETE', id: data.id };
            if (prev.length === 0) return [...prev, undoAction];
            const last = prev[prev.length - 1];
            const newGroup = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
            return [...prev.slice(0, -1), newGroup];
        });
        setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 100);
    },
    onError: (error) => console.error('Auto-Frei creation failed:', error)
  });

  const updateAutoFreiMutation = useMutation({
    mutationFn: ({ id, data }) => db.ShiftEntry.update(id, data),
    onMutate: async ({ id }) => {
        const oldShift = allShifts.find(s => s.id === id);
        return { oldShift };
    },
    onSuccess: (data, { id }, context) => {
        if (context.oldShift) {
            const { id: _, created_date, updated_date, created_by, ...oldData } = context.oldShift;
            const undoAction = { type: 'UPDATE', id, data: oldData };
            
            setUndoStack(prev => {
                if (prev.length === 0) return [...prev, undoAction];
                const last = prev[prev.length - 1];
                const newGroup = Array.isArray(last) ? [...last, undoAction] : [last, undoAction];
                return [...prev.slice(0, -1), newGroup];
            });
        }
        setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 100);
    },
    onError: (error) => console.error('Auto-Frei update failed:', error)
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id) => {
        // Find shift to check for related wish
        const shiftToDelete = allShifts.find(s => s.id === id);
        
        if (shiftToDelete) {
            // Find matching approved wish
            const matchingWish = wishes.find(w => 
                w.doctor_id === shiftToDelete.doctor_id && 
                w.date === shiftToDelete.date && 
                w.status === 'approved' && 
                w.type === 'service' &&
                (!w.position || w.position === shiftToDelete.position)
            );
            
            if (matchingWish) {
                // Revert to pending
                await db.WishRequest.update(matchingWish.id, { status: 'pending' });
            }
        }
        
        return db.ShiftEntry.delete(id);
    },
    onMutate: async (id) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => old.filter(s => s.id !== id));
        }

        const shift = allShifts.find(s => s.id === id);
        return { shift, previousShifts };
    },
    onSuccess: (data, id, context) => {
        // trackDbChange(); // Disabled - MySQL mode
        if (context.shift) {
            const { id: _, created_date, updated_date, created_by, ...shiftData } = context.shift;
            setUndoStack(prev => [...prev, { type: 'CREATE', data: shiftData }]);

            if (user?.role === 'admin' && context.shift.doctor_id && context.shift.doctor_id !== user.doctor_id) {
                db.ShiftNotification.create({
                    doctor_id: context.shift.doctor_id,
                    date: context.shift.date,
                    type: 'delete',
                    message: `Dienst gestrichen: ${context.shift.position}`,
                    acknowledged: false
                });
            }
        }
        setTimeout(() => {
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
        }, 100);
    },
    onError: (error, id, context) => {
        console.error('DEBUG: Delete Mutation Failed', { id, error });
        if (context?.previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
        }
        alert(`Fehler beim Löschen: ${error.message}`);
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
        await Promise.all(ids.map(id => db.ShiftEntry.delete(id)));
    },
    onMutate: async (ids) => {
        await queryClient.cancelQueries(['shifts', fetchRange.start, fetchRange.end]);
        const previousShifts = queryClient.getQueryData(['shifts', fetchRange.start, fetchRange.end]);

        if (previousShifts) {
            queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => old.filter(s => !ids.includes(s.id)));
        }

        const shifts = allShifts.filter(s => ids.includes(s.id));
        return { shifts, previousShifts };
    },
    onError: (err, ids, context) => {
         if (context?.previousShifts) {
             queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], context.previousShifts);
         }
         alert("Fehler beim Löschen: " + err.message);
    },
    onSuccess: (data, ids, context) => {
        // trackDbChange(ids.length); // Disabled - MySQL mode
        if (context.shifts && context.shifts.length > 0) {
            const shiftsData = context.shifts.map(s => {
                const { id, created_date, updated_date, created_by, ...rest } = s;
                return rest;
            });
            setUndoStack(prev => [...prev, { type: 'BULK_CREATE', data: shiftsData }]);
        }
        setTimeout(() => {
            queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]);
        }, 100);
    }
  });

  const createNoteMutation = useMutation({
    mutationFn: (data) => db.ScheduleNote.create(data),
    onSuccess: () => queryClient.invalidateQueries(['scheduleNotes']),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, data }) => db.ScheduleNote.update(id, data),
    onSuccess: () => queryClient.invalidateQueries(['scheduleNotes']),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id) => db.ScheduleNote.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['scheduleNotes']),
  });

  const handleClearWeek = () => {
      const protectedPositions = ["Frei", "Krank", "Urlaub", "Dienstreise"];
      const shiftsToDelete = currentWeekShifts.filter(s => !protectedPositions.includes(s.position));
      
      if (shiftsToDelete.length === 0) return;
      
      if (window.confirm('Möchten Sie den Wochenplan bereinigen? (Abwesenheiten bleiben erhalten)')) {
          const ids = shiftsToDelete.map(s => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const handleClearDay = (date) => {
      const protectedPositions = ["Frei", "Krank", "Urlaub", "Dienstreise"];
      const dateStr = format(date, 'yyyy-MM-dd');
      const shiftsToDelete = currentWeekShifts.filter(s => 
          s.date === dateStr && !protectedPositions.includes(s.position)
      );
      
      if (shiftsToDelete.length === 0) return;

      if (window.confirm(`Möchten Sie die Dienste für ${format(date, 'EEEE', { locale: de })} löschen? (Abwesenheiten bleiben erhalten)`)) {
          const ids = shiftsToDelete.map(s => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const handleClearRow = (rowName, timeslotId = null) => {
      // Bei Timeslot-Zeilen: nur Shifts mit dieser Timeslot-ID löschen
      const shiftsToDelete = currentWeekShifts.filter(s => {
          if (s.position !== rowName) return false;
          if (timeslotId) return s.timeslot_id === timeslotId;
          // Wenn keine Timeslot-ID angegeben, prüfen ob der Arbeitsplatz Timeslots hat
          const workplace = workplaces.find(w => w.name === rowName);
          if (workplace?.timeslots_enabled) {
              // Hat Timeslots - nur Shifts ohne Timeslot löschen (Legacy)
              return !s.timeslot_id;
          }
          // Keine Timeslots - alle löschen
          return true;
      });
      
      if (shiftsToDelete.length === 0) return;

      const displayName = timeslotId 
          ? `${rowName} (Zeitfenster)` 
          : rowName;

      if (window.confirm(`Möchten Sie alle Einträge in der Zeile "${displayName}" für diese Woche löschen?`)) {
          const ids = shiftsToDelete.map(s => s.id);
          bulkDeleteMutation.mutate(ids);
      }
  };

  const [isExporting, setIsExporting] = useState(false);

  const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

  // Synchrone Konfliktprüfung (nur für Voice-Commands)
  const checkConflictsVoice = (doctorId, dateStr, newPosition, excludeShiftId = null) => {
      const result = validate(doctorId, dateStr, newPosition, { excludeShiftId });
      
      if (result.blockers.length > 0) {
          toast.error(result.blockers.join('\n'));
          return true;
      }

      if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('\n'));
      }
      
      return false;
  };

  // Konfliktprüfung mit Override-Dialog
  // Gibt true zurück wenn blockiert (Aktion abbrechen)
  // Wenn Override möglich: zeigt Dialog und führt onProceed bei Bestätigung aus
  const checkConflictsWithOverride = (doctorId, dateStr, newPosition, excludeShiftId = null, onProceed = null) => {
      const result = validate(doctorId, dateStr, newPosition, { excludeShiftId });
      const doctor = doctors.find(d => d.id === doctorId);
      
      // Bei Blockern: Override-Dialog anzeigen
      if (result.blockers.length > 0) {
          requestOverride({
              blockers: result.blockers,
              warnings: result.warnings,
              doctorId,
              doctorName: doctor?.name,
              date: dateStr,
              position: newPosition,
              onConfirm: onProceed
          });
          return true; // Blockiert - warte auf Override-Bestätigung
      }

      // Warnungen anzeigen (kein Blocker)
      if (result.warnings.length > 0) {
          toast.warning(result.warnings.join('\n'));
      }
      
      return false; // Nicht blockiert
  };

  // Legacy-Wrapper für Stellen die noch nicht umgestellt sind
  const checkConflicts = (doctorId, dateStr, newPosition, isVoice = false, excludeShiftId = null) => {
      if (isVoice) {
          return checkConflictsVoice(doctorId, dateStr, newPosition, excludeShiftId);
      }
      // Für non-voice: verwende Override-Dialog ohne Callback
      return checkConflictsWithOverride(doctorId, dateStr, newPosition, excludeShiftId, null);
  };

  // Wrapper für Abwesenheits-spezifische Staffing-Prüfung
  const checkStaffing = (dateStr, doctorId) => {
      const result = validate(doctorId, dateStr, 'Frei', {});
      return result.warnings.length > 0 ? result.warnings.join('\n') : null;
  };

  // Staffing-Prüfung mit Override-Dialog (für Abwesenheiten)
  // Gibt true zurück wenn blockiert (Aktion abbrechen)
  const checkStaffingWithOverride = (doctorId, dateStr, position, onProceed = null) => {
      const result = validate(doctorId, dateStr, position, {});
      const doctor = doctors.find(d => d.id === doctorId);
      
      // Staffing-Warnungen als Override-Möglichkeit anzeigen
      const staffingWarnings = result.warnings.filter(w => 
          w.includes('Mindestbesetzung') || w.includes('anwesend')
      );
      
      if (staffingWarnings.length > 0) {
          requestOverride({
              blockers: staffingWarnings, // Als Blocker anzeigen für Override-Option
              warnings: [],
              doctorId,
              doctorName: doctor?.name,
              date: dateStr,
              position: position,
              onConfirm: onProceed
          });
          return true; // Blockiert - warte auf Override-Bestätigung
      }
      
      return false; // Nicht blockiert
  };

  // Wrapper für Limit-Prüfung (jetzt nur Warnung)
  const checkLimits = (doctorId, dateStr, position) => {
      const result = validate(doctorId, dateStr, position, {});
      const limitWarnings = result.warnings.filter(w => w.includes('Dienstlimit'));
      return limitWarnings.length > 0 ? limitWarnings.join('\n') : null;
  };

  const handleVoiceCommand = async (command) => {
      console.log("Received Voice Command:", command);

      if (command.action === 'unknown') {
          toast.error(command.reason || "Konnte den Befehl nicht verstehen.");
          return;
      }

      // Helper to resolve doctor (handles ID or fuzzy Name match)
      const resolveDoctor = (idOrName) => {
          if (!idOrName) return null;
          
          const term = idOrName.toString().trim();
          const lower = term.toLowerCase();

          // 1. Try exact ID match
          let doc = doctors.find(d => d.id === term);
          if (doc) return doc;

          // 2. Try exact Name/Initials match
          doc = doctors.find(d => d.name.toLowerCase() === lower || (d.initials && d.initials.toLowerCase() === lower));
          if (doc) return doc;

          // 3. Try fuzzy Name match (search term in doctor name)
          doc = doctors.find(d => d.name.toLowerCase().includes(lower));
          if (doc) return doc;

          // 4. Try fuzzy Name match (doctor name parts in search term)
          // Useful if voice recognition captured "Dr. Müller" but stored name is "Müller"
          doc = doctors.find(d => lower.includes(d.name.toLowerCase()));
          if (doc) return doc;
          
          // 5. Last resort: Split search term and find matches for parts
          const parts = lower.split(/\s+/).filter(p => p.length > 2);
          for (const part of parts) {
              doc = doctors.find(d => d.name.toLowerCase().includes(part));
              if (doc) return doc;
          }

          console.log("Resolve Doctor Failed. Term:", term);
          console.log("Available Doctors:", doctors.map(d => `${d.name} (${d.id})`));
          
          return null;
      };

      // Helper to resolve position (handles exact or fuzzy Name match)
      const resolvePosition = (name) => {
          if (!name) return null;
          // 1. Try exact match
          let wp = workplaces.find(w => w.name === name);
          if (wp) return wp.name;

          // 2. Try fuzzy match
          const lower = name.toLowerCase();
          wp = workplaces.find(w => w.name.toLowerCase() === lower);
          if (wp) return wp.name;
          
          // 3. Try contains
          wp = workplaces.find(w => w.name.toLowerCase().includes(lower) || lower.includes(w.name.toLowerCase()));
          if (wp) return wp.name;
          
          return name;
      };

      try {
          let actionHandled = false;

          if (command.action === 'navigate' && command.navigation) {
              if (command.navigation.date) {
                  setCurrentDate(new Date(command.navigation.date));
              }
              if (command.navigation.viewMode) {
                  setViewMode(command.navigation.viewMode);
              }
              toast.success("Ansicht aktualisiert");
              actionHandled = true;
          }

          // Direct API calls to batch operations and avoid multiple re-renders
          let updatesCount = 0;
          let skippedCount = 0;

          if (command.action === 'assign') {
              if (!command.assignments || command.assignments.length === 0) {
                  toast.warning("Keine Zuweisungen im Befehl gefunden.");
                  actionHandled = true; // Handled as warning
              } else {
                  const toCreate = [];
                  const toUpdate = [];

                  for (const assignment of command.assignments) {
                      const { doctor_id, position, date } = assignment;
                      const doc = resolveDoctor(doctor_id);
                      const posName = resolvePosition(position);

                      if (!doc) {
                          toast.error(`Konnte Person "${doctor_id}" nicht finden.`);
                          skippedCount++;
                          continue;
                      }
                      if (!posName) {
                          toast.error(`Konnte Position "${position}" nicht finden.`);
                          skippedCount++;
                          continue;
                      }

                      // 1. Validation
                      if (absencePositions.includes(posName)) {
                           const warning = checkStaffing(date, doc.id);
                           if (warning) toast.warning(warning);
                      } else {
                           // Check limits
                           const limitWarning = checkLimits(doc.id, date, posName);
                           if (limitWarning) toast.warning(limitWarning);

                           // Check conflicts (Blocker)
                           if (checkConflicts(doc.id, date, posName, true)) {
                               skippedCount++;
                               continue; // Skip this assignment
                           }
                      }
                      
                      const existingShift = allShifts.find(s => s.date === date && s.position === posName);
                      
                      if (existingShift) {
                          if (existingShift.doctor_id !== doc.id) {
                              toUpdate.push({ id: existingShift.id, data: { doctor_id: doc.id } });
                          }
                      } else {
                          const cellShifts = allShifts.filter(s => s.date === date && s.position === posName);
                          const pendingInCell = toCreate.filter(s => s.date === date && s.position === posName);
                          const maxOrder = Math.max(
                              cellShifts.reduce((max, s) => Math.max(max, s.order || 0), -1),
                              pendingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1)
                          );
                          toCreate.push({ date, position: posName, doctor_id: doc.id, order: maxOrder + 1 });
                      }
                  }

                  // Execute Batch Operations
                  if (toCreate.length > 0) {
                      await db.ShiftEntry.bulkCreate(toCreate);
                      updatesCount += toCreate.length;
                  }
                  
                  if (toUpdate.length > 0) {
                      await Promise.all(toUpdate.map(item => db.ShiftEntry.update(item.id, item.data)));
                      updatesCount += toUpdate.length;
                  }
                  
                  if (updatesCount > 0) {
                      if (skippedCount > 0) {
                           toast.warning(`${updatesCount} zugewiesen, ${skippedCount} übersprungen (siehe Warnungen).`);
                      } else {
                           toast.success(`${updatesCount} Zuweisung(en) durchgeführt`);
                      }
                  } else if (skippedCount > 0) {
                      toast.error(`Keine Zuweisung durchgeführt. ${skippedCount} Fehler/Konflikte.`);
                  }
                  actionHandled = true;
              }
          }

          if (command.action === 'move') {
              if (!command.move) {
                  toast.warning("Keine Verschiebungsinformationen gefunden.");
                  actionHandled = true;
              } else {
                  const { doctor_id, source_position, target_position, source_date, target_date } = command.move;
                  const doc = resolveDoctor(doctor_id);

                  if (!doc) {
                      toast.error(`Konnte Person "${doctor_id}" nicht finden.`);
                      skippedCount++;
                  } else {
                      const tDate = target_date || source_date;
                      const tPos = resolvePosition(target_position);
                      const sPos = resolvePosition(source_position);
                      const promises = [];

                      if (target_position && !tPos) {
                          toast.error(`Konnte Zielposition "${target_position}" nicht finden.`);
                          skippedCount++;
                      } else if (source_position && !sPos) {
                          toast.error(`Konnte Quellposition "${source_position}" nicht finden.`);
                          skippedCount++;
                      }

                      // Case 1: Move Position
                      else if (tPos) {
                          let shift = null;
                          if (sPos) {
                              shift = allShifts.find(s => s.date === source_date && s.position === sPos && s.doctor_id === doc.id);
                          } else {
                              shift = allShifts.find(s => s.date === source_date && s.doctor_id === doc.id);
                          }

                          if (shift) {
                              promises.push(db.ShiftEntry.update(shift.id, { position: tPos, date: tDate }));
                          } else {
                              toast.warning(`Kein passender Dienst gefunden für ${doc.name}`);
                              skippedCount++;
                          }
                      } 
                      // Case 2: Move Day (all shifts of doc)
                      else if (source_date && tDate && source_date !== tDate) {
                           const shifts = allShifts.filter(s => s.date === source_date && s.doctor_id === doc.id);
                           if (shifts.length > 0) {
                               shifts.forEach(s => promises.push(db.ShiftEntry.update(s.id, { date: tDate })));
                           } else {
                               toast.warning(`Keine Dienste am ${format(new Date(source_date), 'dd.MM.')} gefunden.`);
                               skippedCount++;
                           }
                      }
                      
                      if (promises.length > 0) {
                          await Promise.all(promises);
                          updatesCount += promises.length;
                          toast.success(`${promises.length} Verschiebung(en) durchgeführt`);
                      } else if (skippedCount === 0) {
                          toast.warning("Keine Verschiebungen möglich.");
                      }
                  }
                  actionHandled = true;
              }
          }

          if (command.action === 'delete') {
              if (!command.delete) {
                  toast.warning("Keine Löschinformationen gefunden.");
                  actionHandled = true;
              } else {
                  const { doctor_id, scope, date } = command.delete;
                  const doc = resolveDoctor(doctor_id);

                  if (!doc) {
                      toast.error(`Konnte Person "${doctor_id}" nicht finden.`);
                      skippedCount++;
                  } else {
                      let idsToDelete = [];

                      if (scope === 'day' && date) {
                          const shifts = allShifts.filter(s => s.date === date && s.doctor_id === doc.id);
                          idsToDelete = shifts.map(s => s.id);
                      } else if (scope === 'week') {
                          const startStr = format(weekDays[0], 'yyyy-MM-dd');
                          const endStr = format(weekDays[6], 'yyyy-MM-dd');
                          const shifts = allShifts.filter(s => 
                              s.doctor_id === doc.id && 
                              s.date >= startStr && 
                              s.date <= endStr
                          );
                          idsToDelete = shifts.map(s => s.id);
                      }
                      
                      if (idsToDelete.length > 0) {
                          await Promise.all(idsToDelete.map(id => db.ShiftEntry.delete(id)));
                          toast.success(`${idsToDelete.length} Eintrag/Einträge gelöscht`);
                          updatesCount += idsToDelete.length;
                      } else {
                          toast.warning("Keine passenden Einträge zum Löschen gefunden.");
                          skippedCount++;
                      }
                  }
                  actionHandled = true;
              }
          }

          // Debounced invalidation at the end
          if (updatesCount > 0) {
              setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 150);
          }

          if (!actionHandled) {
               toast.info(`Befehl "${command.action}" wurde erkannt, aber es wurden keine Aktionen ausgeführt.`);
          }

      } catch (err) {
          console.error("Error executing voice command:", err);
          toast.error("Fehler bei der Ausführung: " + err.message);
      }
  };

  const handleExportExcel = async () => {
      setIsExporting(true);
      try {
          // Determine date range based on viewMode
          const startDate = weekDays[0];
          const endDate = weekDays[weekDays.length - 1];
          
          const { data } = await base44.functions.invoke('exportScheduleToExcel', {
              startDate: format(startDate, 'yyyy-MM-dd'),
              endDate: format(endDate, 'yyyy-MM-dd'),
              hiddenRows: hiddenRows
          });
          
          // Decode base64
          const byteCharacters = atob(data.file);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          
          const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `Wochenplan_${format(startDate, 'yyyy-MM-dd')}_bis_${format(endDate, 'yyyy-MM-dd')}.xlsx`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          a.remove();
      } catch (error) {
          console.error("Export Error:", error);
          alert("Export fehlgeschlagen: " + (error.message || "Unbekannter Fehler"));
      } finally {
          setIsExporting(false);
      }
  };

  const weekDays = useMemo(() => {
    if (!isValid(currentDate)) return [];
    if (viewMode === 'day') {
        return [currentDate];
    }
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  }, [currentDate, viewMode]);

  const currentWeekShifts = useMemo(() => {
    // Use weekDays to determine range, ensuring we catch shifts for visible days
    if (weekDays.length === 0) return [];
    
    const start = weekDays[0];
    if (!isValid(start)) return [];

    const end = addDays(weekDays[weekDays.length - 1], 1);
    if (!isValid(end)) return [];
    
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(end, 'yyyy-MM-dd'); // end is exclusive in logic below, but for string range let's be careful
    
    const dbShifts = allShifts.filter(s => {
      // Robust string comparison to avoid timezone issues
      return s.date >= startStr && s.date < endStr;
    });
    
    if (previewShifts) {
        // Add temporary IDs to preview shifts if they don't have them, to avoid key errors
        const formattedPreview = previewShifts.map((s, i) => ({
            ...s,
            id: s.id || `preview-${i}`,
            isPreview: true
        }));
        return [...dbShifts, ...formattedPreview];
    }
    
    return dbShifts;
  }, [allShifts, currentDate, previewShifts]);

  const cleanupAutoFreiOnly = (doctorId, dateStr, position) => {
      const autoFreiShift = findAutoFreiToCleanup(doctorId, dateStr, position);
      if (autoFreiShift) {
          deleteShiftMutation.mutate(autoFreiShift.id);
      }
  };

  const deleteShiftWithCleanup = (shift) => {
      // Skip if temp ID (optimistic update not yet persisted)
      if (shift.id?.startsWith('temp-')) {
          console.log(`[DEBUG-LOG] Skipping delete for temp shift ${shift.id}`);
          // Cancel optimistic update
          queryClient.setQueryData(['shifts', fetchRange.start, fetchRange.end], old => 
              old?.filter(s => s.id !== shift.id) || []
          );
          return;
      }

      console.log(`[DEBUG-LOG] deleteShiftWithCleanup triggered for Shift ${shift.id} (${shift.position})`);
      const idsToDelete = [shift.id];
      if (isAutoOffPosition(shift.position)) {
           const autoFreiShift = findAutoFreiToCleanup(shift.doctor_id, shift.date, shift.position);
           if (autoFreiShift && !autoFreiShift.id?.startsWith('temp-')) {
               console.log(`[DEBUG-LOG] Found Auto-Frei to cleanup: ${autoFreiShift.id}`);
               idsToDelete.push(autoFreiShift.id);
           }
      }

      if (idsToDelete.length === 1) {
          console.log(`[DEBUG-LOG] Mutating Single Delete: ${idsToDelete[0]}`);
          deleteShiftMutation.mutate(idsToDelete[0]);
      } else {
          console.log(`[DEBUG-LOG] Mutating Bulk Delete: ${idsToDelete.join(', ')}`);
          bulkDeleteMutation.mutate(idsToDelete);
      }
  };

  // Called BEFORE dimension capture - must be synchronous to affect measurements
  const handleBeforeCapture = (before) => {
    const { draggableId } = before;
    if (!draggableId) return;

    let docId = null;
    let shiftId = null;
    
    if (draggableId.startsWith('sidebar-doc-')) {
        docId = draggableId.replace('sidebar-doc-', '');
    } else if (draggableId.startsWith('available-doc-')) {
        docId = draggableId.substring(14, draggableId.length - 11);
    } else if (draggableId.startsWith('shift-')) {
        shiftId = draggableId.replace('shift-', '');
        const shift = currentWeekShifts.find(s => s.id === shiftId);
        if (shift) {
            docId = shift.doctor_id;
        }
    }
    // Use flushSync to ensure DOM updates before measurement
    // This is critical for correct drag clone dimensions
    flushSync(() => {
      if (docId) setDraggingDoctorId(docId);
      if (shiftId) setDraggingShiftId(shiftId);
    });
  };

  const handleDragStart = (start) => {
    console.log('Drag Start:', start);
    const { draggableId } = start;
    let docId = null;
    
    if (!draggableId) return;

    if (draggableId.startsWith('sidebar-doc-')) {
        docId = draggableId.replace('sidebar-doc-', '');
    } else if (draggableId.startsWith('available-doc-')) {
        docId = draggableId.substring(14, draggableId.length - 11);
    } else if (draggableId.startsWith('shift-')) {
        const shiftId = draggableId.replace('shift-', '');
        setDraggingShiftId(shiftId);
        const shift = currentWeekShifts.find(s => s.id === shiftId);
        if (shift) {
            docId = shift.doctor_id;
        }
    }
    console.log('Dragging Doctor ID:', docId);
    setDraggingDoctorId(docId);

    // Check if dragging from grid
    const { source } = start;
    if (source.droppableId !== 'sidebar' && !source.droppableId.startsWith('available__')) {
        setIsDraggingFromGrid(true);
    }
    };

  const handleDragEnd = async (result) => {
    setIsDraggingFromGrid(false);
    console.log('DEBUG: Drag Operation Ended', { 
        draggableId: result.draggableId,
        source: result.source,
        destination: result.destination,
        reason: result.reason 
    });
    
    setDraggingDoctorId(null);
    setDraggingShiftId(null);
    const { source, destination, draggableId } = result;

    // If dropped outside any droppable and was from grid -> delete
    if (!destination) {
        if (isDraggingFromGrid && draggableId.startsWith('shift-')) {
            const shiftId = draggableId.replace('shift-', '');
            // Skip temp IDs (optimistic updates not yet persisted)
            if (shiftId.startsWith('temp-')) {
                return;
            }
            const shift = currentWeekShifts.find(s => s.id === shiftId) || allShifts.find(s => s.id === shiftId);
            if (shift) {
                deleteShiftWithCleanup(shift);
            }
        }
        return;
    }

      const absencePositions = ["Frei", "Krank", "Urlaub", "Dienstreise", "Nicht verfügbar"];

      // Helper to find occupying shift for services or demos (for replacement)
      const findOccupyingShift = (dateStr, position, ignoreShiftId = null) => {
          // Enforce single slot for 'Dienste' and 'Demonstrationen & Konsile'
          const targetWorkplace = workplaces.find(w => w.name === position);
          const isSingleSlot = targetWorkplace && ['Dienste', 'Demonstrationen & Konsile'].includes(targetWorkplace.category);

          if (!isSingleSlot) return null;

          return currentWeekShifts.find(s => 
               s.date === dateStr && 
               s.position === position && 
               s.id !== ignoreShiftId
          );
      };

      // Helper to cleanup other shifts when becoming absent
      const cleanupOtherShifts = (doctorId, dateStr, currentShiftId = null) => {
        const shiftsToDelete = currentWeekShifts.filter(s => 
            s.doctor_id === doctorId && 
            s.date === dateStr && 
            s.id !== currentShiftId
        );
        shiftsToDelete.forEach(s => deleteShiftMutation.mutate(s.id));
    };

    // Helper to handle automatic "Frei" after "Dienst Vordergrund" or other auto-off shifts
    const handlePostShiftOff = (doctorId, dateStr, positionName) => {
        // Zentrale Logik: Prüft ob Auto-Frei erstellt werden soll (inkl. Feiertag-Check, ohne Wochenend-Block)
        const autoFreiDateStr = shouldCreateAutoFrei(positionName, dateStr, isPublicHoliday);
        
        if (!autoFreiDateStr) return;

        const nextDay = new Date(autoFreiDateStr);

        // Staffing Check for the auto-off day
        const warning = checkStaffing(autoFreiDateStr, doctorId);
        if (warning) {
            alert(`${warning}\n\n(Durch automatischen Freizeitausgleich am ${format(nextDay, 'dd.MM.')})`);
        }

        const existingShift = allShifts.find(s => s.date === autoFreiDateStr && s.doctor_id === doctorId);

        if (!existingShift) {
            createAutoFreiMutation.mutate({ 
                date: autoFreiDateStr, 
                position: 'Frei', 
                doctor_id: doctorId,
                note: 'Autom. Freizeitausgleich'
            });
        } else if (existingShift.position !== 'Frei') {
             if (window.confirm(`Für den Folgetag (${format(nextDay, 'dd.MM.')}) existiert bereits ein Eintrag "${existingShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                 updateAutoFreiMutation.mutate({
                     id: existingShift.id,
                     data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                 });
             }
        }
    };

    // Handle Drop on Row Header (Assign Mo-Fr)
    if (destination.droppableId.startsWith('rowHeader__')) {
        // Format: rowHeader__position oder rowHeader__position__timeslotId oder rowHeader__position__allTimeslots__
        const headerParts = destination.droppableId.replace('rowHeader__', '').split('__');
        const rowName = headerParts[0];
        const rawHeaderTimeslotId = headerParts[1] || null;
        // Special case: __allTimeslots__ means assign to ALL timeslots of this workplace
        const isAllTimeslots = rawHeaderTimeslotId === 'allTimeslots';
        const rowHeaderTimeslotId = isAllTimeslots ? null : rawHeaderTimeslotId;
        let doctorId = null;

        if (source.droppableId === 'sidebar') {
             doctorId = draggableId.replace('sidebar-doc-', '');
        } else if (draggableId.startsWith('shift-')) {
             const shift = currentWeekShifts.find(s => s.id === draggableId.replace('shift-', ''));
             doctorId = shift?.doctor_id;
        } else if (draggableId.startsWith('available-doc-')) {
             doctorId = draggableId.substring(14, draggableId.length - 11);
        }

        if (!doctorId) return;

        // Get Current Week Monday
        const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
        const daysToAssign = [0, 1, 2, 3, 4].map(offset => addDays(monday, offset)); // Mo-Fr

        const toCreate = [];
        const toDelete = [];

        let successCount = 0;
        let blockedCount = 0;

        for (const day of daysToAssign) {
            const dateStr = format(day, 'yyyy-MM-dd');

            // Check conflicts (using isVoice=true for silent/toast mode to prevent 5 alerts)
            // Note: checkConflicts is defined in outer scope (ScheduleBoard)
            if (checkConflicts(doctorId, dateStr, rowName, true)) { 
                blockedCount++;
                continue;
            }

            // Check limits
            const limitWarning = checkLimits(doctorId, dateStr, rowName);
            if (limitWarning) {
                toast.warning(`Limit Warnung (${format(day, 'dd.MM')}): ${limitWarning}`);
            }

            // Cleanups for target day (similar to single drop)
            if (absencePositions.includes(rowName)) {
                const staffingWarn = checkStaffing(dateStr, doctorId);
                if (staffingWarn) toast.warning(staffingWarn);

                 const others = currentWeekShifts.filter(s => s.doctor_id === doctorId && s.date === dateStr);
                 others.forEach(s => toDelete.push(s.id));
            } else {
                const occupying = findOccupyingShift(dateStr, rowName);
                if (occupying) {
                     if (isAutoOffPosition(occupying.position)) {
                         // cleanupAutoFrei omitted for batch simplicity or handled later
                     }
                     toDelete.push(occupying.id);
                }
            }

            // Prepare Assignment - Duplikat-Prüfung mit Timeslot-Berücksichtigung
            // Bei isAllTimeslots: Schichten für ALLE Timeslots des Arbeitsplatzes erstellen
            const workplace = workplaces.find(w => w.name === rowName);
            const timeslotsToAssign = isAllTimeslots && workplace?.timeslots_enabled
                ? workplaceTimeslots
                    .filter(t => t.workplace_id === workplace.id)
                    .map(t => t.id)
                : [rowHeaderTimeslotId]; // Array mit einem Element (oder null)

            for (const tsId of timeslotsToAssign) {
                const effectiveTsId = tsId === '__unassigned__' ? null : tsId;
                
                const existingShift = currentWeekShifts.find(s => {
                    if (s.date !== dateStr || s.position !== rowName || s.doctor_id !== doctorId) return false;
                    if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                    return !s.timeslot_id;
                });
                if (existingShift) continue; 

                // Bei Timeslot-Zeilen: Filter auch nach timeslot_id
                const cellShifts = currentWeekShifts.filter(s => {
                    if (s.date !== dateStr || s.position !== rowName) return false;
                    if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                    return !s.timeslot_id;
                });
                // Also check pending creates for order calculation within this batch
                const pendingInCell = toCreate.filter(s => s.date === dateStr && s.position === rowName && s.timeslot_id === effectiveTsId);

                const maxOrder = Math.max(
                    cellShifts.reduce((max, s) => Math.max(max, s.order || 0), -1),
                    pendingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1)
                );

                const newShiftData = {
                    date: dateStr,
                    position: rowName,
                    doctor_id: doctorId,
                    order: maxOrder + 1
                };
                // '__unassigned__' bedeutet explizit kein Timeslot (Altdaten-Zeile)
                if (effectiveTsId) {
                    newShiftData.timeslot_id = effectiveTsId;
                }
                toCreate.push(newShiftData);
                successCount++;
            }
        }

        // Execute Batch
        if (toDelete.length > 0) {
            await bulkDeleteMutation.mutateAsync(toDelete);
        }
        if (toCreate.length > 0) {
            const created = await db.ShiftEntry.bulkCreate(toCreate);
            if (created && Array.isArray(created)) {
                setUndoStack(prev => [...prev, { type: 'BULK_DELETE', ids: created.map(c => c.id) }]);
            }
            setTimeout(() => queryClient.invalidateQueries(['shifts', fetchRange.start, fetchRange.end]), 100);
        }

        if (successCount > 0) toast.success(`${successCount} Tage zugewiesen (Mo-Fr)`);
        if (blockedCount > 0) toast.warning(`${blockedCount} Tage übersprungen wegen Konflikten`);

        return;
    }

    // 1. Reordering in Sidebar
    if (source.droppableId === 'sidebar' && destination.droppableId === 'sidebar') {
        if (source.index === destination.index) return;

        const newDoctors = Array.from(doctors);
        const [movedDoctor] = newDoctors.splice(source.index, 1);
        newDoctors.splice(destination.index, 0, movedDoctor);

        newDoctors.forEach((doc, index) => {
            if (doc.order !== index) {
                updateDoctorMutation.mutate({ id: doc.id, data: { order: index } });
            }
        });
        return;
    }

    // Dragged from Grid to Available or Sidebar (Delete/Return)
    // Note: Available droppableId format is `available__${dateStr)}
    const isDestAvailable = destination.droppableId.startsWith('available__') || destination.droppableId.endsWith('__Verfügbar');
    const isSourceFromGrid = source.droppableId !== 'sidebar' && !source.droppableId.startsWith('available__');

    if (isSourceFromGrid && (isDestAvailable || destination.droppableId === 'sidebar')) {
         const shiftId = draggableId.replace('shift-', '');
         const shift = currentWeekShifts.find(s => s.id === shiftId);

         console.log(`[DEBUG-LOG] Drop to Trash/Sidebar. ShiftID: ${shiftId}, Found: ${!!shift}`);

         if (shift) {
             deleteShiftWithCleanup(shift);
         } else {
             console.error(`[DEBUG-LOG] Shift ${shiftId} not found in currentWeekShifts! Available IDs:`, currentWeekShifts.map(s => s.id));
             // Fallback: Try finding in allShifts directly as safety net
             const fallbackShift = allShifts.find(s => s.id === shiftId);
             if (fallbackShift) {
                 console.log(`[DEBUG-LOG] Found shift in allShifts fallback. Deleting.`);
                 deleteShiftWithCleanup(fallbackShift);
             }
         }
         return;
    }

    // 2. Dragged from Sidebar OR Available to Grid (Create)
    if (source.droppableId === 'sidebar' || source.droppableId.startsWith('available__')) {
        // Ignore dragging to trash, unknown destinations, available lists, or back to sidebar
        if (destination.droppableId === 'trash' || destination.droppableId === 'trash-overlay' || destination.droppableId === 'sidebar' || !destination.droppableId.includes('__') || destination.droppableId.endsWith('__Verfügbar') || destination.droppableId.startsWith('available__')) return;

        let doctorId;
        if (source.droppableId === 'sidebar') {
            doctorId = draggableId.replace('sidebar-doc-', '');
        } else {
            doctorId = draggableId.substring(14, draggableId.length - 11);
        }

        // Format: date__position oder date__position__timeslotId oder date__position__allTimeslots__
        const dropParts = destination.droppableId.split('__');
        const dateStr = dropParts[0];
        const position = dropParts[1];
        const rawTimeslotId = dropParts[2] || null;
        // Special case: __allTimeslots__ means assign to ALL timeslots of this workplace
        const isAllTimeslots = rawTimeslotId === 'allTimeslots';
        // '__unassigned__' bedeutet explizit kein Timeslot
        let timeslotId = (rawTimeslotId === '__unassigned__' || isAllTimeslots) ? null : rawTimeslotId;

        // Bei allTimeslots: Alle Timeslots des Arbeitsplatzes ermitteln
        const workplace = workplaces.find(w => w.name === position);
        let timeslotsToAssign = null;
        if (isAllTimeslots && workplace?.timeslots_enabled) {
            timeslotsToAssign = workplaceTimeslots
                .filter(t => t.workplace_id === workplace.id)
                .map(t => t.id);
            console.log('allTimeslots drop - assigning to:', timeslotsToAssign);
        }

        // Auto-Timeslot: Wenn kein Timeslot angegeben, aber Workplace nur einen Timeslot hat,
        // automatisch diesen verwenden
        if (!timeslotId && !isAllTimeslots) {
            if (workplace?.timeslots_enabled) {
                const wpTimeslots = workplaceTimeslots
                    .filter(t => t.workplace_id === workplace.id)
                    .sort((a, b) => (a.order || 0) - (b.order || 0));
                if (wpTimeslots.length === 1) {
                    timeslotId = wpTimeslots[0].id;
                    console.log('Auto-assigning single timeslot:', timeslotId);
                }
            }
        }

        console.log('Dropping Doctor:', doctorId, 'to', dateStr, position, 'timeslotId:', timeslotId);

        if (absencePositions.includes(position)) {
             // Hilfsfunktion für das Erstellen der Abwesenheit
             const executeAbsenceCreation = () => {
                 cleanupOtherShifts(doctorId, dateStr);
                 
                 // Prüfe ob bereits ein Eintrag existiert
                 const existing = currentWeekShifts.find(s => 
                     s.date === dateStr && s.doctor_id === doctorId && s.position === position
                 );
                 if (existing) {
                     console.log('DEBUG: Absence already exists');
                     return;
                 }
                 
                 const existingInCell = currentWeekShifts.filter(s => s.date === dateStr && s.position === position);
                 const maxOrder = existingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                 const newOrder = maxOrder + 1;

                 createShiftMutation.mutate({ date: dateStr, position, doctor_id: doctorId, order: newOrder });
             };

             // Staffing-Prüfung mit Override-Möglichkeit
             const hasStaffingWarning = checkStaffingWithOverride(doctorId, dateStr, position, executeAbsenceCreation);
             if (hasStaffingWarning) {
                 console.log('Staffing warning - waiting for override decision');
                 return;
             }

             // Keine Warnung - direkt ausführen
             executeAbsenceCreation();
             return;
        } else {
             // Check limits for services
             const limitWarning = checkLimits(doctorId, dateStr, position);
             if (limitWarning) alert(limitWarning);

             // WICHTIG: Duplikat-Prüfung VOR dem Löschen des bestehenden Shifts
             // Bei isAllTimeslots: Prüfung pro Timeslot erfolgt später in der Schleife
             // Bei Timeslot-Zeilen auch timeslot_id prüfen
             // '__unassigned__' = Zeile für Shifts ohne Timeslot
             if (!isAllTimeslots) {
                 const effectiveTimeslotId = timeslotId === '__unassigned__' ? null : timeslotId;
                 const exists = currentWeekShifts.some(s => {
                     if (s.date !== dateStr || s.position !== position || s.doctor_id !== doctorId) return false;
                     if (effectiveTimeslotId) return s.timeslot_id === effectiveTimeslotId;
                     return !s.timeslot_id; // Für normale Zeilen ohne Timeslot
                 });

                 if (exists) {
                     console.log('DEBUG: Blocked - Shift already exists for this doctor/date/position/timeslot');
                     alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                     return;
                 }
             }

             const occupyingShift = findOccupyingShift(dateStr, position);
             if (occupyingShift) {
                 deleteShiftWithCleanup(occupyingShift);
             }

             // Hilfsfunktion für das Erstellen der Shifts
             const executeShiftCreation = () => {
                 // Shift erstellen (exists-Prüfung ist jetzt bereits weiter oben erfolgt)
                 // Bei Timeslot-Rows: Filter auch nach timeslot_id
                 // '__unassigned__' = Zeile für Shifts ohne Timeslot
                 const shiftsToCreate = [];
                 
                 // Bei allTimeslots: Für jeden Timeslot eine Schicht erstellen
                 const slotsToProcess = timeslotsToAssign || [timeslotId];
                 
                 for (const tsId of slotsToProcess) {
                     const effectiveTsId = tsId === '__unassigned__' ? null : tsId;
                     
                     // Duplikat-Prüfung pro Timeslot
                     const existsForSlot = currentWeekShifts.some(s => {
                         if (s.date !== dateStr || s.position !== position || s.doctor_id !== doctorId) return false;
                         if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                         return !s.timeslot_id;
                     });
                     if (existsForSlot) {
                         console.log('DEBUG: Skipping - Shift already exists for timeslot:', effectiveTsId);
                         continue;
                     }
                     
                     const existingInCell = currentWeekShifts.filter(s => {
                         if (s.date !== dateStr || s.position !== position) return false;
                         if (effectiveTsId) return s.timeslot_id === effectiveTsId;
                         return !s.timeslot_id;
                     });
                     const maxOrder = existingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                     const newOrder = maxOrder + 1;

                     const newShiftData = { date: dateStr, position, doctor_id: doctorId, order: newOrder };
                     if (effectiveTsId) newShiftData.timeslot_id = effectiveTsId;
                     shiftsToCreate.push(newShiftData);
                 }
                 
                 // Check Auto-Frei immediately to bundle operations
                 const autoFreiDateStr = shouldCreateAutoFrei(position, dateStr, isPublicHoliday);
                 let updateAutoFreiNeeded = false;
                 let existingAutoFreiShift = null;

                 if (autoFreiDateStr) {
                     const warning = checkStaffing(autoFreiDateStr, doctorId);
                     if (warning) {
                         toast.warning(`${warning}\n(Durch automatischen Freizeitausgleich am ${format(new Date(autoFreiDateStr), 'dd.MM.')})`);
                     }

                     existingAutoFreiShift = allShifts.find(s => s.date === autoFreiDateStr && s.doctor_id === doctorId);
                     
                     if (!existingAutoFreiShift) {
                         shiftsToCreate.push({
                             date: autoFreiDateStr,
                             position: 'Frei',
                             doctor_id: doctorId,
                             note: 'Autom. Freizeitausgleich'
                         });
                     } else if (existingAutoFreiShift.position !== 'Frei') {
                         updateAutoFreiNeeded = true;
                     }
                 }

                 console.log('DEBUG: Creating shifts (Bulk)', shiftsToCreate);

                 if (shiftsToCreate.length > 0) {
                     bulkCreateShiftsMutation.mutate(shiftsToCreate, {
                         onSuccess: () => {
                             console.log('DEBUG: Bulk Create Success');
                             // Handle update case if needed (rare case)
                             if (updateAutoFreiNeeded && existingAutoFreiShift) {
                                  if (window.confirm(`Für den Folgetag (${format(new Date(autoFreiDateStr), 'dd.MM.')}) existiert bereits ein Eintrag "${existingAutoFreiShift.position}". Soll dieser durch "Frei" ersetzt werden?`)) {
                                      updateAutoFreiMutation.mutate({
                                          id: existingAutoFreiShift.id,
                                          data: { position: 'Frei', note: 'Autom. Freizeitausgleich' }
                                      });
                                  }
                             }
                         },
                         onError: (err) => {
                             console.error('DEBUG: Error creating shifts:', err);
                             toast.error('Fehler beim Erstellen: ' + err.message);
                         }
                     });
                 }
             };

             // Konfliktprüfung mit Override-Möglichkeit
             const hasConflict = checkConflictsWithOverride(doctorId, dateStr, position, null, executeShiftCreation);
             if (hasConflict) {
                 console.log('Conflict detected - waiting for override decision');
                 return;
             }

             // Kein Konflikt - direkt ausführen
             executeShiftCreation();
        }

        return;
    }

    // Dragged from Grid to Grid
    if (source.droppableId !== 'sidebar' && !source.droppableId.startsWith('available__') && destination.droppableId !== 'sidebar' && destination.droppableId !== 'trash' && destination.droppableId !== 'trash-overlay' && !destination.droppableId.endsWith('__Verfügbar') && !destination.droppableId.startsWith('available__')) {
        const shiftId = draggableId.replace('shift-', '');
        // Format: date__position oder date__position__timeslotId
        const destParts = destination.droppableId.split('__');
        const newDateStr = destParts[0];
        const newPosition = destParts[1];
        const rawNewTimeslotId = destParts[2] || null;
        // '__unassigned__' bedeutet explizit kein Timeslot
        let newTimeslotId = rawNewTimeslotId === '__unassigned__' ? null : rawNewTimeslotId;
        
        // Auto-Timeslot: Wenn kein Timeslot angegeben, aber Workplace nur einen Timeslot hat,
        // automatisch diesen verwenden
        if (!newTimeslotId) {
            const workplace = workplaces.find(w => w.name === newPosition);
            if (workplace?.timeslots_enabled) {
                const wpTimeslots = workplaceTimeslots
                    .filter(t => t.workplace_id === workplace.id)
                    .sort((a, b) => (a.order || 0) - (b.order || 0));
                if (wpTimeslots.length === 1) {
                    newTimeslotId = wpTimeslots[0].id;
                    console.log('Auto-assigning single timeslot for move:', newTimeslotId);
                }
            }
        }
        
        const srcParts = source.droppableId.split('__');
        const oldDateStr = srcParts[0];
        const oldPosition = srcParts[1];
        const rawOldTimeslotId = srcParts[2] || null;
        const oldTimeslotId = rawOldTimeslotId === '__unassigned__' ? null : rawOldTimeslotId;

        if (source.droppableId === destination.droppableId) {
            if (source.index === destination.index) return;

            // Bei Reordering innerhalb derselben Zelle: auch Timeslot-ID berücksichtigen
            const cellShifts = currentWeekShifts
                .filter(s => {
                    if (s.date !== newDateStr || s.position !== newPosition) return false;
                    if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                    return !s.timeslot_id;
                })
                .sort((a, b) => (a.order || 0) - (b.order || 0));

            const newShifts = Array.from(cellShifts);
            const [movedShift] = newShifts.splice(source.index, 1);
            newShifts.splice(destination.index, 0, movedShift);

            newShifts.forEach((s, index) => {
                if (s.order !== index) {
                    updateShiftMutation.mutate({ id: s.id, data: { order: index } });
                }
            });
            return;
        }

        const shift = currentWeekShifts.find(s => s.id === shiftId);
        if (!shift) return;

        // Check for Copy Mode (CTRL pressed)
        if (isCtrlPressed && source.droppableId !== destination.droppableId) {
             // Check duplicate in target (mit Timeslot-Berücksichtigung)
             const alreadyInTarget = currentWeekShifts.some(s => {
                 if (s.date !== newDateStr || s.position !== newPosition || s.doctor_id !== shift.doctor_id) return false;
                 if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                 return !s.timeslot_id;
             });
             if (alreadyInTarget) {
                 alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                 return;
             }

             if (absencePositions.includes(newPosition)) {
                 // Hilfsfunktion für die Kopie-Erstellung bei Abwesenheit
                 const executeCopyAbsence = () => {
                     cleanupOtherShifts(shift.doctor_id, newDateStr);
                     
                     const existingInNewCell = currentWeekShifts.filter(s => {
                         if (s.date !== newDateStr || s.position !== newPosition) return false;
                         if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                         return !s.timeslot_id;
                     });
                     const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                     const newOrder = maxOrder + 1;

                     const copyData = { date: newDateStr, position: newPosition, doctor_id: shift.doctor_id, order: newOrder };
                     if (newTimeslotId) copyData.timeslot_id = newTimeslotId;

                     createShiftMutation.mutate(copyData, {
                         onSuccess: () => {
                             handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                         }
                     });
                 };

                 // Staffing-Prüfung mit Override-Möglichkeit
                 const hasStaffingWarning = checkStaffingWithOverride(shift.doctor_id, newDateStr, newPosition, executeCopyAbsence);
                 if (hasStaffingWarning) return;
                 
                 // Keine Warnung - direkt ausführen
                 executeCopyAbsence();
                 return;
             } else {
                 // Check limits for services
                 const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
                 if (limitWarning) toast.warning(limitWarning);

                 const occupyingShift = findOccupyingShift(newDateStr, newPosition);
                 if (occupyingShift) {
                     if (isAutoOffPosition(occupyingShift.position)) {
                         cleanupAutoFrei(occupyingShift.doctor_id, occupyingShift.date, occupyingShift.position);
                     }
                     deleteShiftMutation.mutate(occupyingShift.id);
                 }
                 
                 // Hilfsfunktion für die Kopie-Erstellung
                 const executeCopy = () => {
                     const existingInNewCell = currentWeekShifts.filter(s => {
                         if (s.date !== newDateStr || s.position !== newPosition) return false;
                         if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                         return !s.timeslot_id;
                     });
                     const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                     const newOrder = maxOrder + 1;

                     const copyData = { date: newDateStr, position: newPosition, doctor_id: shift.doctor_id, order: newOrder };
                     if (newTimeslotId) copyData.timeslot_id = newTimeslotId;

                     createShiftMutation.mutate(copyData, {
                         onSuccess: () => {
                             handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                         }
                     });
                 };

                 // Konfliktprüfung mit Override-Möglichkeit
                 const hasConflict = checkConflictsWithOverride(shift.doctor_id, newDateStr, newPosition, null, executeCopy);
                 if (hasConflict) return;
                 
                 // Kein Konflikt - direkt ausführen
                 executeCopy();
             }

             return;
        }

        // Check if moving FROM an Auto-Off position
        const wasAutoOff = isAutoOffPosition(shift.position);
        
        if (wasAutoOff && (newPosition !== shift.position || newDateStr !== shift.date)) {
            cleanupAutoFreiOnly(shift.doctor_id, shift.date, shift.position);
        }

        // Check duplicate in target (excluding self) - only if position or timeslot changed
        const positionOrTimeslotChanged = newPosition !== shift.position || newTimeslotId !== shift.timeslot_id;
        if (positionOrTimeslotChanged) {
            const alreadyInTarget = currentWeekShifts.some(s => {
                if (s.date !== newDateStr || s.position !== newPosition || s.doctor_id !== shift.doctor_id || s.id === shiftId) return false;
                if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                return !s.timeslot_id;
            });
            if (alreadyInTarget) {
                alert('Mitarbeiter ist in dieser Position bereits eingeteilt.');
                return;
            }
        }

        if (absencePositions.includes(newPosition)) {
             // Moving TO absence -> Staffing-Prüfung mit Override
             
             // Hilfsfunktion für das Verschieben zur Abwesenheit
             const executeMoveToAbsence = () => {
                 cleanupOtherShifts(shift.doctor_id, newDateStr, shiftId);
                 
                 const existingInNewCell = currentWeekShifts.filter(s => {
                     if (s.date !== newDateStr || s.position !== newPosition) return false;
                     if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                     return !s.timeslot_id;
                 });
                 const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                 const newOrder = maxOrder + 1;

                 const updateData = { date: newDateStr, position: newPosition, order: newOrder };
                 if (newTimeslotId !== undefined) {
                     updateData.timeslot_id = newTimeslotId;
                 }

                 updateShiftMutation.mutate(
                     { id: shiftId, data: updateData },
                     {
                         onSuccess: () => {
                             handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                         }
                     }
                 );
             };

             // Staffing-Prüfung mit Override-Möglichkeit
             const hasStaffingWarning = checkStaffingWithOverride(shift.doctor_id, newDateStr, newPosition, executeMoveToAbsence);
             if (hasStaffingWarning) return;
             
             // Keine Warnung - direkt ausführen
             executeMoveToAbsence();
             return;
        } else {
             // Moving TO work -> check conflicts
             
             // Check limits for services
             const limitWarning = checkLimits(shift.doctor_id, newDateStr, newPosition);
             if (limitWarning) toast.warning(limitWarning);

             const occupyingShift = findOccupyingShift(newDateStr, newPosition, shiftId);
             if (occupyingShift) {
                 deleteShiftWithCleanup(occupyingShift);
             }

             // Hilfsfunktion für das Update
             const executeMove = () => {
                 const existingInNewCell = currentWeekShifts.filter(s => {
                     if (s.date !== newDateStr || s.position !== newPosition) return false;
                     if (newTimeslotId) return s.timeslot_id === newTimeslotId;
                     return !s.timeslot_id;
                 });
                 const maxOrder = existingInNewCell.reduce((max, s) => Math.max(max, s.order || 0), -1);
                 const newOrder = maxOrder + 1;

                 const updateData = { date: newDateStr, position: newPosition, order: newOrder };
                 if (newTimeslotId !== undefined) {
                     updateData.timeslot_id = newTimeslotId;
                 }

                 updateShiftMutation.mutate(
                     { id: shiftId, data: updateData },
                     {
                         onSuccess: () => {
                             handlePostShiftOff(shift.doctor_id, newDateStr, newPosition);
                         }
                     }
                 );
             };

             // Konfliktprüfung mit Override-Möglichkeit
             const hasConflict = checkConflictsWithOverride(shift.doctor_id, newDateStr, newPosition, null, executeMove);
             if (hasConflict) return;
             
             // Kein Konflikt - direkt ausführen
             executeMove();
             return;
        }
        return;
    }
  };
  
  const applyPreview = async () => {
      if (!previewShifts) return;
      await db.ShiftEntry.bulkCreate(previewShifts);
      queryClient.invalidateQueries(['shifts']);
      setPreviewShifts(null);
  };

  const cancelPreview = () => {
      setPreviewShifts(null);
  };

  const handleAutoFill = async () => {
    setIsGenerating(true);
    try {
      const weekDates = weekDays.map(d => format(d, 'yyyy-MM-dd'));
      const weekStart = weekDates[0];
      const weekEnd = weekDates[6];
      
      // 1. Prepare Rotations Map for better context
      const relevantRotations = trainingRotations.filter(rot => {
         return (rot.start_date <= weekEnd && rot.end_date >= weekStart);
      }).map(rot => {
          const doc = doctors.find(d => d.id === rot.doctor_id);
          return {
              doctor_id: rot.doctor_id,
              doctor_name: doc ? doc.name : 'Unknown',
              modality: rot.modality,
              start: rot.start_date,
              end: rot.end_date
          };
      });

      // 2. Existing Shifts (Absences & Services)
      const existingShiftsData = currentWeekShifts.map(s => ({
          date: s.date,
          doctor_id: s.doctor_id,
          position: s.position
      }));

      const holidays = weekDays.filter(d => isPublicHoliday(d)).map(d => format(d, 'yyyy-MM-dd'));

      const prompt = `
        Du bist ein strikter Dienstplaner für eine Radiologie.
        Deine Aufgabe ist es, JEDEN offenen Arbeitsplatz für die Woche ${weekStart} bis ${weekEnd} zu besetzen.
        
        --- INPUT DATEN ---
        
        1. VERFÜGBARE ÄRZTE:
        ${JSON.stringify(doctors.map(d => ({ id: d.id, name: d.name, role: d.role })), null, 2)}
        
        2. BEREITS BLOCKIERTE ÄRZTE (Abwesenheiten & Manuelle Dienste):
        Diesen Ärzten darfst du an den jeweiligen Tagen KEINEN neuen Arbeitsplatz zuweisen!
        ${JSON.stringify(existingShiftsData, null, 2)}
        
        3. PFLICHT-ROTATIONEN (Höchste Priorität!):
        Wenn ein Arzt hier gelistet ist und verfügbar ist, MUSS er zwingend in diese Funktion eingeteilt werden.
        ${JSON.stringify(relevantRotations, null, 2)}
        
        4. ZUSÄTZLICHE REGELN:
        ${scheduleRules.filter(r => r.is_active).map((r, i) => `${i+1}. ${r.content}`).join('\n')}
        
        --- ZU BESETZENDE ARBEITSPLÄTZE ---
        
        FÜR JEDEN WERKTAG (Mo-Fr), der KEIN Feiertag ist (Feiertage: ${holidays.join(', ')}),
        MUSST du folgende Positionen besetzen:
        
        - 1x "DL/konv. Rö" (Prio: Assistenzarzt)
        - 1x "Sonographie" (Prio: Assistenzarzt)
        - 3x "CT" (mind. 1 Facharzt/Oberarzt, Rest Assistenten)
        - 2x "Mammographie" (1 Erfahrener + 1 Assistent wenn möglich)
        - 2x "Angiographie" (Prio: Erfahrene)
        - 2x "MRT" (1 Erfahrener + 1 Assistent wenn möglich)
        
        --- ALGORITHMUS ---
        
        Für jeden Werktag (Tag X):
        1. Filtere Ärzte, die an Tag X "Frei", "Krank", "Urlaub", "Dienstreise" oder "Dienst..." haben. Diese sind RAUS.
        2. Nimm alle verbleibenden Ärzte.
        3. SCHRITT A (Rotationen): Weise zuerst alle Ärzte zu, die eine aktive Rotation haben.
           - Bsp: Arzt A hat "Angio"-Rotation -> Setze ihn auf "Angiographie".
        4. SCHRITT B (Auffüllen): Fülle die verbleibenden offenen Positionen (siehe Liste oben) mit den restlichen verfügbaren Ärzten auf.
           - Achte auf Qualifikation (CT braucht mind 1 erfahrenen Arzt).
           - Versuche eine faire Verteilung.
           - Wenn mehr Plätze als Ärzte da sind: Besetze so viele wie möglich (Prio: CT, MRT, Angio).
           - Wenn mehr Ärzte als Plätze da sind: Weise übrigen Ärzten sinnvolle Positionen zu (z.B. doppelte Besetzung oder "Sonstiges").
        
        WICHTIG:
        - Generiere NUR Zuweisungen für Werktage (Mo-Fr), die keine Feiertage sind.
        - KEINE Zuweisungen am Wochenende (Sa/So).
        - Ignoriere Positionen "Dienst Vordergrund/Hintergrund/Spätdienst" (diese sind manuell).
        
        OUTPUT FORMAT:
        { "assignments": [{ "date": "YYYY-MM-DD", "position": "PositionName", "doctor_id": "ID" }] }
      `;
      
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
            type: "object",
            properties: {
                assignments: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            date: { type: "string" },
                            position: { type: "string" },
                            doctor_id: { type: "string" }
                        },
                        required: ["date", "position", "doctor_id"]
                    }
                }
            }
        }
      });

      if (response && response.assignments) {
         // Post-processing filter to enforce rules strictly
         // All Rotations + Spätdienst (or all Services) are forbidden on weekends for AI generation
         const rotationRows = workplaces.filter(w => w.category === 'Rotationen').map(w => w.name);
         const serviceRows = workplaces.filter(w => w.category === 'Dienste').map(w => w.name);
         
         const forbiddenWeekendPositions = [...rotationRows, ...serviceRows];
         const forbiddenServicePositions = serviceRows;

         const validAssignments = response.assignments.filter(assignment => {
            const date = new Date(assignment.date);
            const dateStr = assignment.date;
            const isWeekendDay = isWeekend(date);
            const isHoliday = isPublicHoliday(date);
            
            // Rule 0: No services generated by AI (User Request)
            if (forbiddenServicePositions.includes(assignment.position)) {
                return false;
            }

            // Rule 1: Strict Weekend/Holiday check for functional areas
            if ((isWeekendDay || isHoliday) && forbiddenWeekendPositions.includes(assignment.position)) {
                return false;
            }

            // Rule 2: No double booking (check against existing DB shifts)
            const isBlocked = existingShiftsData.some(s => 
                s.date === dateStr && s.doctor_id === assignment.doctor_id
            );
            
            if (isBlocked) return false;

            return true;
         });

         // Rule 3: Auto-generate "Frei" after Auto-Off positions
         const additionalFreiShifts = [];
         validAssignments.forEach(assignment => {
             const wp = workplaces.find(w => w.name === assignment.position);
             if (wp && wp.auto_off) {
                 const currentDay = new Date(assignment.date);
                 const nextDay = addDays(currentDay, 1);
                 
                 // Skip if next day is weekend or holiday
                 if (isWeekend(nextDay) || isPublicHoliday(nextDay)) return;
                 
                 const nextDayStr = format(nextDay, 'yyyy-MM-dd');
                 const doctorId = assignment.doctor_id;
                 
                 // Check for conflicts on next day (existing DB, newly generated, or already added Frei)
                 const hasExisting = existingShiftsData.some(s => s.date === nextDayStr && s.doctor_id === doctorId);
                 const hasNew = validAssignments.some(s => s.date === nextDayStr && s.doctor_id === doctorId);
                 const hasPendingFrei = additionalFreiShifts.some(s => s.date === nextDayStr && s.doctor_id === doctorId);

                 if (!hasExisting && !hasNew && !hasPendingFrei) {
                     additionalFreiShifts.push({
                         date: nextDayStr,
                         position: 'Frei',
                         doctor_id: doctorId,
                         note: 'Autom. Freizeitausgleich (KI)'
                     });
                 }
             }
         });

         setPreviewShifts([...validAssignments, ...additionalFreiShifts]);
      }
    } catch (error) {
      console.error("AI Error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderCellShifts = useMemo(() => (date, rowName, isSectionFullWidth, timeslotId = null, allTimeslotIds = null, singleTimeslotId = null) => {
    // Wait for color settings to load
    if (isLoadingColors) return null;
    if (!isValid(date)) return null;
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // Filter shifts by position and optionally by timeslot_id
    let shifts = currentWeekShifts.filter(s => {
      if (s.date !== dateStr || s.position !== rowName) return false;
      
      // Fall 0: Einzelner Timeslot - zeige nur Shifts dieses Timeslots + Shifts ohne Timeslot
      // Verhält sich wie normale Zeile, aber inkludiert Shifts des einzigen Timeslots
      if (singleTimeslotId) {
        return s.timeslot_id === singleTimeslotId || !s.timeslot_id;
      }
      
      // Fall 1: Eingeklappte Gruppe - zeige ALLE Shifts aus allen Timeslots + Shifts ohne Timeslot
      if (allTimeslotIds && allTimeslotIds.length > 0) {
        return allTimeslotIds.includes(s.timeslot_id) || !s.timeslot_id;
      }
      
      // Fall 2: "Nicht zugewiesen" Zeile - zeige nur Shifts ohne timeslot_id
      if (timeslotId === '__unassigned__') {
        return !s.timeslot_id;
      }
      
      // Fall 3: Spezifische timeslotId angegeben (Timeslot-Unterzeile)
      if (timeslotId !== null) {
        return s.timeslot_id === timeslotId;
      }
      
      // Fall 4: Gruppen-Header (isTimeslotGroupHeader mit timeslotId === null)
      // Zeigt nichts direkt an - Shifts werden in Unterzeilen oder "Nicht zugewiesen" angezeigt
      const workplace = workplaces.find(w => w.name === rowName);
      if (workplace?.timeslots_enabled) {
        // Bei aktivierten Timeslots: Header-Zeile zeigt keine Shifts (werden in Unterzeilen gezeigt)
        return false;
      }
      
      // Arbeitsplatz hat keine Timeslots - zeige alle Shifts
      return true;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));

    // Bei eingeklappter Gruppe: Dedupliziere Ärzte, die in mehreren Timeslots eingetragen sind
    // Zeige jeden Arzt nur EINMAL an, auch wenn er in allen Timeslots ist
    if (allTimeslotIds && allTimeslotIds.length > 0) {
      const seenDoctorIds = new Set();
      shifts = shifts.filter(shift => {
        if (seenDoctorIds.has(shift.doctor_id)) {
          return false; // Duplikat überspringen
        }
        seenDoctorIds.add(shift.doctor_id);
        return true;
      });
    }

    const isSingleShift = shifts.length === 1;
    const isFullWidth = isSectionFullWidth || isSingleShift;

    return shifts.map((shift, index) => {
        const doctor = doctors.find(d => d.id === shift.doctor_id);
        if (!doctor) return null;
        
        const roleColor = getRoleColor(doctor.role);
        const isDraggingThis = draggingShiftId === shift.id;
        const showCopyGhost = isCtrlPressed && isDraggingThis;

        return (
            <div key={shift.id} style={{ display: 'contents' }}>
                {showCopyGhost && (
                    <div 
                        className="flex items-center justify-center rounded-md font-bold border shadow-sm opacity-40 border-dashed border-slate-400 pointer-events-none"
                        style={{
                            fontSize: `${gridFontSize}px`,
                            backgroundColor: roleColor.backgroundColor,
                            color: roleColor.color,
                            width: isFullWidth ? '100%' : `${gridFontSize * 3.5}px`,
                            height: isFullWidth ? '100%' : `${gridFontSize * 3.5}px`,
                            minHeight: isFullWidth ? `${gridFontSize * 3.5 * 0.8}px` : undefined,
                            marginBottom: '4px'
                        }}
                    >
                        <span className="truncate px-1">
                            {isFullWidth ? doctor.name : doctor.initials}
                        </span>
                    </div>
                )}
                <DraggableShift 
                    shift={shift} 
                    doctor={doctor} 
                    index={index}
                    style={roleColor}
                    isFullWidth={isFullWidth}
                    isDragDisabled={isReadOnly}
                    fontSize={gridFontSize}
                    boxSize={gridFontSize * 3.5}
                    currentUserDoctorId={user?.doctor_id}
                    highlightMyName={highlightMyName}
                    isBeingDragged={isDraggingThis}
                />
            </div>
        );
    });
  }, [currentWeekShifts, doctors, draggingShiftId, isCtrlPressed, gridFontSize, isReadOnly, user, highlightMyName, colorSettings, isLoadingColors, getRoleColor, workplaces]);

  // Render clone for shift drags from cells - matches sidebar behavior
  const renderShiftClone = useMemo(() => (provided, snapshot, rubric) => {
    const draggableId = rubric.draggableId;
    if (!draggableId.startsWith('shift-')) return null;
    
    const shiftId = draggableId.replace('shift-', '');
    const shift = currentWeekShifts.find(s => s.id === shiftId);
    if (!shift) return null;
    
    const doctor = doctors.find(d => d.id === shift.doctor_id);
    if (!doctor) return null;
    
    const roleColor = getRoleColor(doctor.role);
    
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        className="flex items-center justify-center"
        style={{
          ...provided.draggableProps.style,
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          width: '60px',
          height: '32px',
        }}
      >
        <div 
          className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400 px-2 py-1"
          style={{
            backgroundColor: roleColor?.backgroundColor || '#f1f5f9',
            color: roleColor?.color || '#0f172a',
            minWidth: '40px',
            zIndex: 9999,
          }}
        >
          <span className="text-xs">{doctor?.initials || doctor?.name?.substring(0, 3)}</span>
        </div>
      </div>
    );
  }, [currentWeekShifts, doctors, getRoleColor]);

  // Mobile View
  if (isMobile) {
      return (
          <MobileScheduleView
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              shifts={currentWeekShifts}
              doctors={doctors}
              workplaces={workplaces}
              isPublicHoliday={isPublicHoliday}
              isSchoolHoliday={isSchoolHoliday}
          />
      );
  }

  return (
    <div className="flex flex-col h-full space-y-4">

      <div className="flex flex-wrap gap-2 items-center bg-white p-2 sm:p-4 rounded-lg shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
        {/* VoiceControl removed - moved to Layout */}

        <Button 
            variant="outline" 
            size="icon"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Rückgängig (Ctrl+Z)"
            className={`h-9 w-9 ${undoStack.length > 0 ? "text-indigo-600 border-indigo-200 hover:bg-indigo-50" : "opacity-50"}`}
        >
            <Undo className="w-4 h-4" />
        </Button>

        <Button 
            variant="outline" 
            onClick={() => setCurrentDate(viewMode === 'week' ? startOfWeek(new Date(), { weekStartsOn: 1 }) : new Date())}
            className="h-9"
        >
            Heute
        </Button>
          <div className="flex items-center bg-slate-100 rounded-md p-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(d => addDays(d, viewMode === 'week' ? -7 : -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 sm:px-4 font-medium w-[180px] sm:w-[280px] text-center block truncate text-sm">
              {viewMode === 'week' ? (
                  `${format(weekDays[0], 'd. MMM', { locale: de })} - ${format(weekDays[6], 'd. MMM', { locale: de })}`
              ) : (
                  format(currentDate, 'EEE, d. MMM yyyy', { locale: de })
              )}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCurrentDate(d => addDays(d, viewMode === 'week' ? 7 : 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex bg-slate-100 rounded-lg p-1">
              <button 
                  onClick={() => {
                    setViewMode('week');
                    setCurrentDate(d => startOfWeek(d, { weekStartsOn: 1 }));
                  }}
                  className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${viewMode === 'week' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <Calendar className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Woche</span>
              </button>
              <button 
                  onClick={() => setViewMode('day')}
                  className={`flex items-center px-2 py-1 rounded-md text-sm font-medium transition-all ${viewMode === 'day' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <LayoutList className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Tag</span>
              </button>
          </div>
          {previewShifts && (
             <div className="flex items-center bg-indigo-50 text-indigo-700 px-3 py-1 rounded-md border border-indigo-200">
                 <span className="text-sm font-medium mr-3">KI: {previewShifts.length}</span>
                 <Button size="sm" onClick={applyPreview} className="bg-indigo-600 hover:bg-indigo-700 text-white h-7 mr-2">OK</Button>
                 <Button size="sm" variant="ghost" onClick={cancelPreview} className="h-7 hover:bg-indigo-100 hover:text-indigo-800">X</Button>
             </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
             <Button 
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={isExporting}
                title="Export nach Excel"
                className="h-9"
             >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline ml-1">Export</span>
             </Button>
             {currentWeekShifts.length > 0 && !isReadOnly && (
                 <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={handleClearWeek}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 h-9"
                 >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline ml-1">Leeren</span>
                 </Button>
             )}
             {!isReadOnly && (
                 <>
                     <WorkplaceConfigDialog />
                     <ColorSettingsDialog />
                 </>
             )}
             <SectionConfigDialog />
                <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                       <Button variant="outline" size="icon" title="Ansicht anpassen">
                           <Eye className="h-4 w-4" />
                       </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="end" className="w-56">
                       <DropdownMenuLabel>Ansicht</DropdownMenuLabel>
                       <DropdownMenuCheckboxItem 
                           checked={showSidebar}
                           onCheckedChange={setShowSidebar}
                       >
                           Ärzteleiste anzeigen
                       </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem 
                           checked={highlightMyName}
                           onCheckedChange={setHighlightMyName}
                       >
                           Eigenen Namen hervorheben
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
                           {sections.flatMap(s => s.rows).map((row, idx) => {
                               // Rückwärtskompatibilität: Falls string, in Objekt konvertieren
                               const rowObj = typeof row === 'string' 
                                   ? { name: row, displayName: row } 
                                   : row;
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
                                       setHiddenRows(prev => 
                                           checked 
                                               ? prev.filter(r => r !== rowName) 
                                               : [...prev, rowName]
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

                <DragDropContext 
                  onBeforeCapture={handleBeforeCapture}
                  onDragStart={handleDragStart} 
                  onDragEnd={handleDragEnd}
                  autoScrollerOptions={{ disabled: true }}
                >

                  <div className="flex flex-col lg:flex-row gap-6 items-start relative min-h-[500px]">

                  {/* Sidebar */}
                {showSidebar && (
                <div className={`w-full lg:w-64 flex-shrink-0 bg-white p-4 rounded-lg shadow-sm border border-slate-200 lg:sticky lg:top-4 max-h-[calc(100vh-200px)] flex flex-col gap-4 z-50 ${draggingDoctorId ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                <div>
                <h3 className="font-semibold text-slate-700 mb-3 flex items-center">
                    <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">{doctors.length}</span>
                    Verfügbares Personal
                </h3>
                <Droppable 
                    droppableId="sidebar" 
                    isDropDisabled={isReadOnly}
                    renderClone={(provided, snapshot, rubric) => {
                        const doctor = doctors[rubric.source.index];
                        const roleStyle = getRoleColor(doctor?.role);
                        return (
                            <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className="flex items-center justify-center"
                                style={{
                                    ...provided.draggableProps.style,
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    boxShadow: 'none',
                                    width: '60px',
                                    height: '32px',
                                }}
                            >
                                <div 
                                    className="flex items-center justify-center rounded-md font-bold border shadow-2xl ring-4 ring-indigo-400 px-2 py-1"
                                    style={{
                                        backgroundColor: roleStyle?.backgroundColor || '#ffffff',
                                        color: roleStyle?.color || '#000000',
                                        minWidth: '40px',
                                        zIndex: 9999,
                                    }}
                                >
                                    <span className="text-xs">{doctor?.initials || doctor?.name?.substring(0, 3)}</span>
                                </div>
                            </div>
                        );
                    }}
                >
                    {(provided) => (
                        <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
                            {doctors.map((doctor, index) => (
                                <DraggableDoctor 
                                    key={doctor.id} 
                                    doctor={doctor} 
                                    index={index} 
                                    style={getRoleColor(doctor.role)}
                                    isDragDisabled={isReadOnly}
                                    isBeingDragged={draggingDoctorId === doctor.id}
                                />
                            ))}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </div>
            
            {/* Trash removed - use overlay instead */}
                            </div>
                            )}

                            {/* Matrix */}
                            <div className={`flex-1 bg-white rounded-lg shadow-sm border border-slate-200 max-h-[calc(100vh-180px)] z-0 ${draggingDoctorId ? 'overflow-hidden' : 'overflow-auto'}`}>
                            <div className="min-w-[800px]">
                              <div className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm`}>
                <div className="p-3 font-semibold text-slate-700 border-r border-slate-200 flex items-center bg-slate-50">
                    Bereich / Datum
                </div>
                {weekDays.map(day => {
                    if (!isValid(day)) return <div key={Math.random()} className="p-2 text-center text-red-500">Invalid Date</div>;

                    const isToday = isSameDay(day, new Date());
                    const hasShifts = currentWeekShifts.some(s => s.date === format(day, 'yyyy-MM-dd'));
                    const isHoliday = isPublicHoliday(day);
                    const isSchoolHol = isSchoolHoliday(day);

                    let bgClass = '';
                    if (isToday) bgClass = 'bg-yellow-50/30 border-x-2 border-t-2 border-yellow-400 border-b border-slate-200 text-yellow-900';
                    else if (isHoliday) bgClass = 'bg-blue-100 text-blue-900';
                    else if (isSchoolHol) bgClass = 'bg-green-100 text-green-900';
                    else if ([0,6].includes(day.getDay())) bgClass = 'bg-orange-50/50';

                    // Validation Logic
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayShifts = currentWeekShifts.filter(s => s.date === dateStr);
                    const assignedDocIds = new Set(dayShifts.map(s => s.doctor_id));
                    const unassignedDocs = doctors.filter(d => !assignedDocIds.has(d.id) && d.role !== 'Nicht-Radiologe');
                    
                    // Rotations are in sections[2] (if structure maintained)
                    // Better: find section by title
                    const rotationSection = sections.find(s => s.title === "Rotationen");
                    const rotationRows = rotationSection ? rotationSection.rows : [];
                    const filledPositions = new Set(dayShifts.map(s => s.position));
                    const allRotationsFilled = rotationRows.length > 0 && rotationRows.every(r => filledPositions.has(r));

                    const showWarning = allRotationsFilled && unassignedDocs.length > 0 && !isHoliday && ![0,6].includes(day.getDay());

                    return (
                        <div key={day.toISOString()} className={`group relative p-2 text-center border-r border-slate-200 last:border-r-0 ${bgClass || 'bg-white'}`}>
                            <div className={`font-semibold ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>
                                {format(day, 'EEEE', { locale: de })}
                            </div>
                            <div className={`text-xs ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                                {format(day, 'dd.MM.', { locale: de })}
                                {isHoliday && <span className="block text-[10px] opacity-75 leading-tight mt-1">Feiertag</span>}
                                {isSchoolHol && !isHoliday && <span className="block text-[10px] opacity-75 leading-tight mt-1">Ferien</span>}
                            </div>

                            {showWarning && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button className="absolute top-1 left-1 p-1 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 transition-colors" title="Unbesetzte Ärzte">
                                            <AlertTriangle className="w-3 h-3" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-3">
                                        <div className="space-y-2">
                                            <h4 className="font-medium text-sm text-amber-800 flex items-center gap-2">
                                                <AlertTriangle className="w-4 h-4" />
                                                Nicht eingeteilte Ärzte
                                            </h4>
                                            <div className="text-xs text-slate-600">
                                                Folgende Ärzte haben heute noch keinen Eintrag (weder Dienst noch Abwesenheit):
                                            </div>
                                            <ScrollArea className="h-[200px] border rounded-md bg-slate-50 p-2">
                                                <div className="space-y-1">
                                                    {unassignedDocs.map(doc => (
                                                        <div key={doc.id} className="flex items-center gap-2 text-sm text-slate-700 p-1 hover:bg-white rounded">
                                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${getRoleColor(doc.role).backgroundColor}`} style={{ color: getRoleColor(doc.role).color }}>
                                                                {doc.initials}
                                                            </div>
                                                            <span>{doc.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </ScrollArea>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                            
                            {hasShifts && (
                                <button
                                    onClick={() => handleClearDay(day)}
                                    className="absolute top-1 right-1 p-1 rounded-full bg-white/80 text-red-400 hover:text-red-600 hover:bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Tag leeren"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    );
                })}
              </div>

              {sections.map((section, sIdx) => {
                // rows sind jetzt Objekte mit { name, displayName, timeslotId, isTimeslotRow, isTimeslotGroupHeader }
                // Für Rückwärtskompatibilität: Falls string, in Objekt konvertieren
                const normalizedRows = section.rows.map(r => 
                    typeof r === 'string' ? { name: r, displayName: r, timeslotId: null, isTimeslotRow: false, isTimeslotGroupHeader: false } : r
                );
                
                // Filter: Versteckte Zeilen ausblenden + Timeslot-Zeilen ausblenden wenn Gruppe eingeklappt
                // + "Nicht zugewiesen" Zeilen ausblenden wenn keine Altdaten vorhanden
                const visibleRows = normalizedRows.filter(r => {
                    if (hiddenRows.includes(r.name)) return false;
                    // Timeslot-Unterzeilen ausblenden wenn die Gruppe eingeklappt ist
                    if (r.isTimeslotRow && collapsedTimeslotGroups.includes(r.name)) return false;
                    // "Nicht zugewiesen" Zeile nur anzeigen wenn es Altdaten gibt
                    if (r.isUnassignedRow) {
                        const hasUnassignedShifts = currentWeekShifts.some(s => 
                            s.position === r.name && !s.timeslot_id
                        );
                        if (!hasUnassignedShifts) return false;
                    }
                    return true;
                });
                if (visibleRows.length === 0) return null;
                
                const isCollapsed = collapsedSections.includes(section.title);
                const customStyle = getSectionStyle(section.title);

                return (
                <div key={sIdx}>
                    <div 
                        className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 flex items-center justify-between cursor-pointer select-none transition-colors ${!customStyle ? section.headerColor : ''}`}
                        style={customStyle ? customStyle.header : {}}
                        onClick={() => setCollapsedSections(prev => prev.includes(section.title) ? prev.filter(t => t !== section.title) : [...prev, section.title])}
                    >
                        <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            {getSectionName(section.title)}
                        </div>
                        <span className="text-[10px] opacity-70 bg-white/20 px-2 py-0.5 rounded-full">
                            {visibleRows.length}
                        </span>
                    </div>
                    
                    {!isCollapsed && visibleRows.map((rowObj, rIdx) => {
                        const rowName = rowObj.name;
                        const rowDisplayName = rowObj.displayName || rowName;
                        const rowTimeslotId = rowObj.timeslotId;
                        const isGroupHeader = rowObj.isTimeslotGroupHeader;
                        const isGroupCollapsed = collapsedTimeslotGroups.includes(rowName);
                        const rowStyle = getRowStyle(rowName, customStyle);
                        
                        // Gruppen-Header: droppableId mit spezieller Markierung "__allTimeslots__"
                        const headerDroppableId = isGroupHeader 
                            ? `rowHeader__${rowName}__allTimeslots__`
                            : `rowHeader__${rowName}${rowTimeslotId ? '__' + rowTimeslotId : ''}`;
                        
                        return (
                        <div key={`${sIdx}-${rowDisplayName}-${rowTimeslotId || 'full'}`} className={`grid ${viewMode === 'day' ? 'grid-cols-[200px_1fr]' : 'grid-cols-[200px_repeat(7,1fr)]'} border-b border-slate-200 ${(draggingDoctorId || draggingShiftId) ? '' : 'hover:bg-slate-50/50'} transition-colors group`}>
                            <Droppable droppableId={headerDroppableId} isDropDisabled={isReadOnly}>
                                {(provided, snapshot) => (
                                    <div 
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                        className={`p-2 text-sm font-medium border-r border-slate-200 flex items-center justify-between transition-colors ${!customStyle ? section.headerColor : ''} ${snapshot.isDraggingOver ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50' : ''} ${isGroupHeader ? 'cursor-pointer' : ''}`}
                                        style={customStyle ? customStyle.header : {}}
                                        onClick={isGroupHeader ? () => toggleTimeslotGroup(rowName) : undefined}
                                    >
                                        <div className="flex flex-col min-w-0">
                                            <span className="truncate flex items-center gap-1" title={rowDisplayName}>
                                                {isGroupHeader && (
                                                    <span className="text-slate-500">
                                                        {isGroupCollapsed ? <ChevronRight className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />}
                                                    </span>
                                                )}
                                                {rowObj.isTimeslotRow && !rowObj.isUnassignedRow && <span className="text-slate-400 mr-1">↳</span>}
                                                {rowObj.isUnassignedRow && <span className="text-amber-500 mr-1">⚠</span>}
                                                <span className={rowObj.isUnassignedRow ? 'text-amber-700' : ''}>
                                                    {rowDisplayName}
                                                </span>
                                                {isGroupHeader && rowObj.timeslotCount && (
                                                    <span className="text-[10px] text-slate-400 ml-1">({rowObj.timeslotCount})</span>
                                                )}
                                            </span>
                                            {rowObj.isUnassignedRow && (
                                                <span className="text-[10px] font-normal text-amber-600">
                                                    Bitte Zeitfenster zuweisen
                                                </span>
                                            )}
                                            {rowObj.isTimeslotRow && !rowObj.isUnassignedRow && rowObj.startTime && (
                                                <span className="text-[10px] font-normal opacity-80">
                                                    {rowObj.startTime?.substring(0,5)}-{rowObj.endTime?.substring(0,5)}
                                                </span>
                                            )}
                                            {!rowObj.isTimeslotRow && workplaces.find(s => s.name === rowName)?.time && (
                                                <span className="text-[10px] font-normal opacity-80">
                                                    {workplaces.find(s => s.name === rowName).time} Uhr
                                                </span>
                                                )}
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                {!isReadOnly && rowName !== 'Verfügbar' && (
                                                <Button 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600"
                                                    onClick={() => handleClearRow(rowName, rowTimeslotId)}
                                                    title="Zeile leeren"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                                )}
                                                <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:bg-black/10"
                                                onClick={() => setHiddenRows(prev => [...prev, rowName])}
                                                title="Zeile ausblenden"
                                                >
                                                <EyeOff className="h-3 w-3 opacity-50" />
                                                </Button>
                                                </div>
                                                <div className="hidden">{provided.placeholder}</div>
                                    </div>
                                )}
                            </Droppable>
                            {weekDays.map((day, dIdx) => {
                                const isWeekend = [0, 6].includes(day.getDay());
                                const isToday = isSameDay(day, new Date());
                                const dateStr = format(day, 'yyyy-MM-dd');
                                // Unique ID for droppable: date__position oder date__position__timeslotId
                                // Gruppen-Header: Spezielle Markierung "__allTimeslots__" für Zuweisung zu allen Timeslots
                                const cellId = isGroupHeader
                                    ? `${dateStr}__${rowName}__allTimeslots__`
                                    : rowTimeslotId 
                                        ? `${dateStr}__${rowName}__${rowTimeslotId}`
                                        : `${dateStr}__${rowName}`;
                                
                                // Check if it's a demo row and if it's allowed
                                let isDisabled = false;
                                let disabledText = null;
                                let isTrainingHighlight = false;

                                if (draggingDoctorId) {
                                    const activeRotations = trainingRotations.filter(rot => 
                                        rot.doctor_id === draggingDoctorId &&
                                        rot.start_date <= dateStr &&
                                        rot.end_date >= dateStr
                                    );
                                    
                                    // Check match (handling mapping for Röntgen)
                                    const isTarget = activeRotations.some(rot => 
                                        rot.modality === rowName || 
                                        (rot.modality === 'Röntgen' && (rowName === 'DL/konv. Rö' || rowName.includes('Rö')))
                                    );
                                    
                                    if (isTarget) {
                                        isTrainingHighlight = true;
                                    }
                                }

                                // Check if rowName is in the Demo section (using sections state)
                                // Rows sind jetzt Objekte, daher prüfen wir r.name statt r direkt
                                const isDemoSection = sections.find(s => s.title === "Demonstrationen & Konsile")?.rows.some(r => 
                                    (typeof r === 'string' ? r : r.name) === rowName
                                );

                                if (isDemoSection) {
                                    const setting = workplaces.find(s => s.name === rowName);
                                    if (setting) {
                                        const dayOfWeek = day.getDay(); // 0-6
                                        const allowed = setting.active_days ? setting.active_days.includes(dayOfWeek) : true;
                                        if (setting.active_days && !allowed) {
                                            isDisabled = true;
                                        }
                                    }
                                }

                                // Additional logic for Dienste if needed (e.g. specific colors or icons)
                                // Rows sind jetzt Objekte, daher prüfen wir r.name statt r direkt
                                const isServiceSection = sections.find(s => s.title === "Dienste")?.rows.some(r => 
                                    (typeof r === 'string' ? r : r.name) === rowName
                                );
                                if (isServiceSection) {
                                     const setting = workplaces.find(s => s.name === rowName);
                                     if (setting && setting.auto_off) {
                                         // Maybe indicate visually that this causes auto-off?
                                         // Currently no UI request for this, keeping it simple.
                                     }
                                }

                                return (
                                    <div key={dIdx} className={`border-r border-slate-100 last:border-r-0`}>
                                        {rowName === 'Verfügbar' ? (
                                            <Droppable droppableId={`available__${dateStr}`} isDropDisabled={isReadOnly}>
                                                {(provided, snapshot) => {
                                                    // Calculate available doctors
                                                    // Filter out doctors who are already assigned to a BLOCKING position
                                                    const blockingShifts = currentWeekShifts.filter(s => {
                                                        if (s.date !== dateStr) return false;

                                                        const wp = workplaces.find(w => w.name === s.position);

                                                        // NEW: If workplace doesn't affect availability, it's never blocking
                                                        // (except for absences which have no workplace entry)
                                                        if (wp?.affects_availability === false) return false;

                                                        // Explicit permission for rotation concurrency
                                                        if (wp?.allows_rotation_concurrently === true) return false;

                                                        // Explicit prohibition
                                                        if (wp?.allows_rotation_concurrently === false) return true;

                                                        // Default behavior based on category (Dienste/Demos don't block by default)
                                                        if (wp && ['Dienste', 'Demonstrationen & Konsile'].includes(wp.category)) return false;

                                                        // Default blocking (Absences, Rotations, Unknowns)
                                                        return true;
                                                    });

                                                    const assignedDocIds = new Set(blockingShifts.map(s => s.doctor_id));
                                                    const availableDocs = doctors.filter(d => !assignedDocIds.has(d.id) && d.role !== 'Nicht-Radiologe');

                                                    return (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.droppableProps}
                                                            className={`min-h-[40px] p-1 flex flex-wrap gap-1 transition-colors ${snapshot.isDraggingOver ? 'bg-green-100' : 'bg-green-50/30'}`}
                                                        >
                                                            {availableDocs.map((doc, idx) => (
                                                                <Draggable 
                                                                    key={`available-${doc.id}-${dateStr}`} 
                                                                    draggableId={`available-doc-${doc.id}-${dateStr}`} 
                                                                    index={idx}
                                                                    isDragDisabled={isReadOnly}
                                                                >
                                                                    {(provided, snapshot) => {
                                                                        let style = getRoleColor(doc.role);
                                                                        const wish = wishes.find(w => w.doctor_id === doc.id && w.date === dateStr && w.status !== 'rejected');
                                                                        let wishClass = "";
                                                                        const isCurrentUser = user?.doctor_id && doc.id === user.doctor_id;
                                                                        if (isCurrentUser && highlightMyName) wishClass = "ring-2 ring-red-500 ring-offset-1 z-10";

                                                                        let tooltipText = doc.name;

                                                                        if (wish) {
                                                                            if (wish.type === 'service') {
                                                                                style = { backgroundColor: '#dcfce7', color: '#166534' }; // Green
                                                                                wishClass = "ring-1 ring-green-500";
                                                                                tooltipText += `\nWunsch: ${wish.position || 'Dienst'}\nPrio: ${wish.priority}\n${wish.reason ? `Grund: ${wish.reason}` : ''}`;
                                                                            } else if (wish.type === 'no_service') {
                                                                                style = { backgroundColor: '#fee2e2', color: '#991b1b' }; // Red
                                                                                wishClass = "ring-1 ring-red-500";
                                                                                tooltipText += `\nWunsch: Kein Dienst\nPrio: ${wish.priority}\n${wish.reason ? `Grund: ${wish.reason}` : ''}`;
                                                                            }
                                                                        }

                                                                        return (
                                                                            <div
                                                                                ref={provided.innerRef}
                                                                                {...provided.draggableProps}
                                                                                {...provided.dragHandleProps}
                                                                                style={{ ...provided.draggableProps.style, ...style }}
                                                                                className={`
                                                                                    text-[10px] px-1.5 py-0.5 rounded border shadow-sm select-none truncate max-w-[100px]
                                                                                    ${snapshot.isDragging ? 'opacity-50 ring-2 ring-indigo-500 z-50' : ''}
                                                                                    ${wishClass}
                                                                                `}
                                                                                title={tooltipText}
                                                                            >
                                                                                {doc.initials}
                                                                            </div>
                                                                        );
                                                                    }}
                                                                </Draggable>
                                                            ))}
                                                            {provided.placeholder}
                                                        </div>
                                                    );
                                                }}
                                            </Droppable>
                                        ) : rowName === 'Sonstiges' ? (
                                            isReadOnly ? (
                                                <div className="p-2 text-base text-slate-500 h-full min-h-[40px] whitespace-pre-wrap">
                                                    {scheduleNotes.find(n => n.date === format(day, 'yyyy-MM-dd') && n.position === rowName)?.content || ''}
                                                </div>
                                            ) : (
                                                <FreeTextCell 
                                                    date={day}
                                                    rowName={rowName}
                                                    notes={scheduleNotes}
                                                    onCreate={createNoteMutation}
                                                    onUpdate={updateNoteMutation}
                                                    onDelete={deleteNoteMutation}
                                                />
                                            )
                                        ) : (
                                            <DroppableCell 
                                                id={cellId}
                                                isToday={isToday}
                                                isWeekend={isWeekend}
                                                isDisabled={isDisabled}
                                                isReadOnly={isReadOnly}
                                                isAlternate={rIdx % 2 !== 0}
                                                isTrainingHighlight={isTrainingHighlight}
                                                baseClassName={!customStyle && !rowStyle.backgroundColor ? section.rowColor : ''}
                                                baseStyle={rowStyle.backgroundColor ? { backgroundColor: rowStyle.backgroundColor, color: rowStyle.color } : {}}
                                                renderClone={renderShiftClone}
                                            >
                                                {renderCellShifts(
                                                    day, 
                                                    rowName, 
                                                    ["Dienste", "Demonstrationen & Konsile"].includes(section.title), 
                                                    rowTimeslotId,
                                                    isGroupHeader && isGroupCollapsed ? rowObj.allTimeslotIds : null,
                                                    rowObj.singleTimeslotId || null
                                                )}
                                            </DroppableCell>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        );
                    })}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      </DragDropContext>
      
      {/* Override Confirm Dialog */}
      <OverrideConfirmDialog
          open={overrideDialog.open}
          onOpenChange={setOverrideDialogOpen}
          blockers={overrideDialog.blockers}
          warnings={overrideDialog.warnings}
          context={overrideDialog.context}
          onConfirm={confirmOverride}
          onCancel={cancelOverride}
      />
    </div>
  );
}