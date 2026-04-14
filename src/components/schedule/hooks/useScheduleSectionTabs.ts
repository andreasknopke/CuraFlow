import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { PINNED_SECTION_TITLE } from '../utils/scheduleConstants';
import type { SectionTab, ViewMode } from '../utils/scheduleFormatters';
import {
  getAvailableSectionTabs,
  getSplitSectionsForTab,
  getVisibleSectionsForTab,
  type ScheduleSectionLike,
} from '../utils/scheduleSectionViews';

interface ToastLike {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

interface UseScheduleSectionTabsOptions<T extends ScheduleSectionLike> {
  initialActiveSectionTabId: string;
  allSections: T[];
  sectionTabs: SectionTab[];
  isLoadingSystemSettings: boolean;
  isMobile: boolean;
  isEmbeddedSchedule: boolean;
  viewMode: ViewMode;
  currentDate: Date;
  getSectionName: (name: string) => string;
  persistSectionTabs: (tabs: SectionTab[]) => Promise<void>;
  toast: ToastLike;
}

export function useScheduleSectionTabs<T extends ScheduleSectionLike>({
  initialActiveSectionTabId,
  allSections,
  sectionTabs,
  isLoadingSystemSettings,
  isMobile,
  isEmbeddedSchedule,
  viewMode,
  currentDate,
  getSectionName,
  persistSectionTabs,
  toast,
}: UseScheduleSectionTabsOptions<T>) {
  const [activeSectionTabId, setActiveSectionTabId] = useState(initialActiveSectionTabId);
  const [isSplitViewEnabled, setIsSplitViewEnabled] = useState(false);
  const [splitSectionTabId, setSplitSectionTabId] = useState('');
  const [localSectionTabs, setLocalSectionTabs] = useState(sectionTabs);
  const sectionTabsSnapshot = JSON.stringify(
    sectionTabs.map((tab) => ({ id: tab.id, sectionTitle: tab.sectionTitle })),
  );

  useEffect(() => {
    setLocalSectionTabs(sectionTabs);
  }, [sectionTabsSnapshot]);

  const availableSectionTabs = useMemo(
    () => getAvailableSectionTabs(localSectionTabs, allSections),
    [localSectionTabs, allSections],
  );

  useEffect(() => {
    if (isLoadingSystemSettings) return;
    if (activeSectionTabId === 'main') return;
    if (!availableSectionTabs.find((tab) => tab.id === activeSectionTabId)) {
      setActiveSectionTabId('main');
    }
  }, [activeSectionTabId, availableSectionTabs, isLoadingSystemSettings]);

  useEffect(() => {
    if (isSplitViewEnabled && activeSectionTabId !== 'main') {
      setActiveSectionTabId('main');
    }
  }, [isSplitViewEnabled, activeSectionTabId]);

  useEffect(() => {
    if (!availableSectionTabs.length) {
      setIsSplitViewEnabled(false);
      setSplitSectionTabId('');
      return;
    }

    if (splitSectionTabId && !availableSectionTabs.some((tab) => tab.id === splitSectionTabId)) {
      setSplitSectionTabId(availableSectionTabs[0].id);
    }
  }, [availableSectionTabs, splitSectionTabId]);

  useEffect(() => {
    if (isMobile && isSplitViewEnabled) {
      setIsSplitViewEnabled(false);
    }
  }, [isMobile, isSplitViewEnabled]);

  useEffect(() => {
    if (viewMode === 'month' && isSplitViewEnabled) {
      setIsSplitViewEnabled(false);
    }
  }, [viewMode, isSplitViewEnabled]);

  const canUseSplitView = !isEmbeddedSchedule && !isMobile && viewMode !== 'month';
  const effectiveSplitTabId = availableSectionTabs.some((tab) => tab.id === splitSectionTabId)
    ? splitSectionTabId
    : availableSectionTabs[0]?.id || '';

  const splitSections = useMemo(
    () =>
      getSplitSectionsForTab(
        isSplitViewEnabled,
        effectiveSplitTabId,
        availableSectionTabs,
        allSections,
      ),
    [isSplitViewEnabled, effectiveSplitTabId, availableSectionTabs, allSections],
  );

  const sections = useMemo(
    () => getVisibleSectionsForTab(activeSectionTabId, availableSectionTabs, allSections),
    [activeSectionTabId, availableSectionTabs, allSections],
  );

  const handleMoveSectionToTab = async (sectionTitle: string) => {
    if (sectionTitle === PINNED_SECTION_TITLE) {
      toast.info(`"${getSectionName(PINNED_SECTION_TITLE)}" bleibt immer im Hauptplan enthalten`);
      return;
    }

    const existing = availableSectionTabs.find((tab) => tab.sectionTitle === sectionTitle);
    if (existing) {
      setActiveSectionTabId(existing.id);
      return;
    }

    const slug = sectionTitle.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const newTab = {
      id: `tab_${Date.now()}_${slug}`,
      sectionTitle,
    };

    try {
      const nextTabs = [...localSectionTabs, newTab];
      setLocalSectionTabs(nextTabs);
      await persistSectionTabs(nextTabs);
      setActiveSectionTabId(newTab.id);
      toast.success(`"${getSectionName(sectionTitle)}" wurde in einen eigenen Reiter verschoben`);
    } catch {
      setLocalSectionTabs(sectionTabs);
      toast.error('Reiter konnte nicht gespeichert werden');
    }
  };

  const handleCloseSectionTab = async (tabId: string) => {
    try {
      const nextTabs = localSectionTabs.filter((tab) => tab.id !== tabId);
      setLocalSectionTabs(nextTabs);
      await persistSectionTabs(nextTabs);
      if (activeSectionTabId === tabId) {
        setActiveSectionTabId('main');
      }
    } catch {
      setLocalSectionTabs(sectionTabs);
      toast.error('Reiter konnte nicht entfernt werden');
    }
  };

  const handleOpenSectionTabInNewWindow = (tabId: string) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('sectionTab', tabId);
    nextUrl.searchParams.set('view', viewMode);
    nextUrl.searchParams.set('date', format(currentDate, 'yyyy-MM-dd'));

    const popupWidth = Math.min(1400, Math.max(1000, Math.floor(window.screen.availWidth * 0.75)));
    const popupHeight = Math.min(900, Math.max(700, Math.floor(window.screen.availHeight * 0.8)));
    const popupLeft = Math.max(0, Math.floor((window.screen.availWidth - popupWidth) / 2));
    const popupTop = Math.max(0, Math.floor((window.screen.availHeight - popupHeight) / 2));
    const windowFeatures = `noopener,noreferrer,width=${popupWidth},height=${popupHeight},left=${popupLeft},top=${popupTop}`;

    const openedWindow = window.open(
      nextUrl.toString(),
      `schedule_tab_${tabId}_${Date.now()}`,
      windowFeatures,
    );

    if (!openedWindow) {
      toast.error('Neues Fenster wurde vom Browser blockiert');
      return;
    }

    setActiveSectionTabId('main');
  };

  const handleOpenSectionTabInSplitView = (tabId: string) => {
    if (!canUseSplitView) return;
    setSplitSectionTabId(tabId);
    setIsSplitViewEnabled(true);
    setActiveSectionTabId('main');
  };

  return {
    activeSectionTabId,
    setActiveSectionTabId,
    isSplitViewEnabled,
    setIsSplitViewEnabled,
    splitSectionTabId,
    availableSectionTabs,
    canUseSplitView,
    effectiveSplitTabId,
    splitSections,
    sections,
    handleMoveSectionToTab,
    handleCloseSectionTab,
    handleOpenSectionTabInNewWindow,
    handleOpenSectionTabInSplitView,
  };
}
