import { expect, type Locator, type Page } from '@playwright/test';

export class SchedulePage {
  readonly page: Page;
  readonly root: Locator;
  readonly currentPeriodLabel: Locator;
  readonly previousPeriodButton: Locator;
  readonly nextPeriodButton: Locator;
  readonly monthViewButton: Locator;
  readonly weekViewButton: Locator;
  readonly dayViewButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('schedule-page');
    this.currentPeriodLabel = page.getByTestId('schedule-current-period');
    this.previousPeriodButton = page.getByTestId('schedule-nav-prev');
    this.nextPeriodButton = page.getByTestId('schedule-nav-next');
    this.monthViewButton = page.getByTestId('schedule-view-month');
    this.weekViewButton = page.getByTestId('schedule-view-week');
    this.dayViewButton = page.getByTestId('schedule-view-day');
  }

  async goto(date: string, view: 'week' | 'month' | 'day' = 'week') {
    await this.page.goto(`/schedule?view=${view}&date=${date}`);
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.root).toBeVisible();
    await expect(this.currentPeriodLabel).toBeVisible();
  }

  shift(shiftId: string) {
    return this.page.getByTestId(`schedule-shift-${shiftId}`);
  }

  qualificationWarning(shiftId: string) {
    return this.page.getByTestId(`schedule-shift-qualification-warning-${shiftId}`);
  }

  async openMonthView() {
    await this.monthViewButton.click();
    await expect(this.monthViewButton).toHaveAttribute('data-state', 'active');
  }

  async openWeekView() {
    await this.weekViewButton.click();
    await expect(this.weekViewButton).toHaveAttribute('data-state', 'active');
  }

  async goToNextPeriod() {
    await this.nextPeriodButton.click();
  }

  async goToPreviousPeriod() {
    await this.previousPeriodButton.click();
  }
}
