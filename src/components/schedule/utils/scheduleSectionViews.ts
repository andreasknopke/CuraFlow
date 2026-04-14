import { PINNED_SECTION_TITLE } from './scheduleConstants';
import type { SectionTab } from './scheduleFormatters';

export interface ScheduleSectionLike {
  title: string;
}

export const getAvailableSectionTabs = <T extends ScheduleSectionLike>(
  sectionTabs: SectionTab[] = [],
  allSections: T[] = [],
): SectionTab[] => {
  const knownTitles = new Set(allSections.map((section) => section.title));
  return sectionTabs.filter(
    (tab) => knownTitles.has(tab.sectionTitle) && tab.sectionTitle !== PINNED_SECTION_TITLE,
  );
};

export const getSplitSectionsForTab = <T extends ScheduleSectionLike>(
  isSplitViewEnabled: boolean,
  splitSectionTabId: string,
  availableSectionTabs: SectionTab[] = [],
  allSections: T[] = [],
): T[] => {
  if (!isSplitViewEnabled || !splitSectionTabId) return [];

  const activeTab = availableSectionTabs.find((tab) => tab.id === splitSectionTabId);
  if (!activeTab) return [];

  const activeSection = allSections.find((section) => section.title === activeTab.sectionTitle);
  const pinnedSection = allSections.find((section) => section.title === PINNED_SECTION_TITLE);

  if (!activeSection) return [];
  if (!pinnedSection || activeSection.title === PINNED_SECTION_TITLE) return [activeSection];

  return [activeSection, pinnedSection];
};

export const getVisibleSectionsForTab = <T extends ScheduleSectionLike>(
  activeSectionTabId: string,
  availableSectionTabs: SectionTab[] = [],
  allSections: T[] = [],
): T[] => {
  if (activeSectionTabId === 'main') {
    const assignedTitles = new Set(availableSectionTabs.map((tab) => tab.sectionTitle));
    return allSections.filter(
      (section) => section.title === PINNED_SECTION_TITLE || !assignedTitles.has(section.title),
    );
  }

  const activeTab = availableSectionTabs.find((tab) => tab.id === activeSectionTabId);
  if (!activeTab) return allSections;

  const activeSection = allSections.find((section) => section.title === activeTab.sectionTitle);
  const pinnedSection = allSections.find((section) => section.title === PINNED_SECTION_TITLE);

  if (!activeSection) return allSections;
  if (!pinnedSection || activeSection.title === PINNED_SECTION_TITLE) return [activeSection];

  return [activeSection, pinnedSection];
};
