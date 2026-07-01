import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoDatabaseProblemToast } from '../support/uiAssertions';

export class SchedulePage {
  readonly page: Page;
  readonly root: Locator;
  readonly currentPeriodLabel: Locator;
  readonly previousPeriodButton: Locator;
  readonly nextPeriodButton: Locator;
  readonly monthViewButton: Locator;
  readonly weekViewButton: Locator;
  readonly dayViewButton: Locator;
  readonly undoButton: Locator;
  readonly autoFillTrigger: Locator;
  readonly autoFillAll: Locator;
  readonly previewBar: Locator;
  readonly previewApplyButton: Locator;
  readonly previewDiscardButton: Locator;
  readonly clearWeekButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('schedule-page');
    this.currentPeriodLabel = page.getByTestId('schedule-current-period');
    this.previousPeriodButton = page.getByTestId('schedule-nav-prev');
    this.nextPeriodButton = page.getByTestId('schedule-nav-next');
    this.monthViewButton = page.getByTestId('schedule-view-month');
    this.weekViewButton = page.getByTestId('schedule-view-week');
    this.dayViewButton = page.getByTestId('schedule-view-day');
    this.undoButton = page.getByTestId('schedule-undo');
    this.autoFillTrigger = page.getByTestId('schedule-auto-fill-trigger');
    this.autoFillAll = page.getByTestId('schedule-auto-fill-all');
    this.previewBar = page.getByTestId('schedule-preview-bar');
    this.previewApplyButton = page.getByTestId('schedule-preview-apply');
    this.previewDiscardButton = page.getByTestId('schedule-preview-discard');
    this.clearWeekButton = page.getByTestId('schedule-clear-week');
  }

  async goto(date: string, view: 'week' | 'month' | 'day' = 'week') {
    await this.page.goto(`/schedule?view=${view}&date=${date}`);
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.root).toBeVisible();
    await expect(this.currentPeriodLabel).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  shift(shiftId: string) {
    return this.page.getByTestId(`schedule-shift-${shiftId}`);
  }

  qualificationWarning(shiftId: string) {
    return this.page.getByTestId(`schedule-shift-qualification-warning-${shiftId}`);
  }

  availableDoctor(doctorId: string, date: string) {
    return this.page.getByTestId(`schedule-available-doctor-${doctorId}-${date}`);
  }

  sidebarDoctorHandle(doctorId: string) {
    return this.page.getByTestId(`schedule-sidebar-doctor-handle-${doctorId}`);
  }

  cell(date: string, rowName: string, timeslotId?: string | null) {
    const rawCellId = timeslotId ? `${date}__${rowName}__${timeslotId}` : `${date}__${rowName}`;
    return this.page.getByTestId(`schedule-cell-${encodeURIComponent(rawCellId)}`);
  }

  dayClearButton(date: string) {
    return this.page.getByTestId(`schedule-day-clear-${date}`);
  }

  rowTargetId(rowName: string, timeslotId?: string | null) {
    const rawHeaderId = timeslotId ? `rowHeader__${rowName}__${timeslotId}` : `rowHeader__${rowName}`;
    return encodeURIComponent(rawHeaderId);
  }

  rowHeader(rowName: string, timeslotId?: string | null) {
    return this.page.getByTestId(`schedule-row-header-${this.rowTargetId(rowName, timeslotId)}`);
  }

  rowClearButton(rowName: string, timeslotId?: string | null) {
    return this.page.getByTestId(`schedule-row-clear-${this.rowTargetId(rowName, timeslotId)}`);
  }

  groupRowHeader(rowName: string) {
    return this.rowHeader(rowName, 'allTimeslots');
  }

  groupRowClearButton(rowName: string) {
    return this.rowClearButton(rowName, 'allTimeslots');
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

  async dragAvailableDoctorToCell(doctorId: string, date: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.availableDoctor(doctorId, date), this.cell(date, rowName, timeslotId));
  }

  async dragSidebarDoctorToCell(doctorId: string, date: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.sidebarDoctorHandle(doctorId), this.cell(date, rowName, timeslotId));
  }

  async dragSidebarDoctorToRowHeader(doctorId: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.sidebarDoctorHandle(doctorId), this.rowHeader(rowName, timeslotId));
  }

  async dragShiftToCell(shiftId: string, date: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.shift(shiftId), this.cell(date, rowName, timeslotId));
  }

  async clearDay(date: string) {
    const dialogPromise = this.page.waitForEvent('dialog');
    await this.dayClearButton(date).click({ force: true });
    const dialog = await dialogPromise;
    await dialog.accept();
  }

  async clearRow(rowName: string, timeslotId?: string | null) {
    const dialogPromise = this.page.waitForEvent('dialog');
    await this.rowClearButton(rowName, timeslotId).evaluate((element: HTMLButtonElement) => element.click());
    const dialog = await dialogPromise;
    await dialog.accept();
  }

  async undoLastChange() {
    await this.undoButton.click();
  }

  async dragShiftOffGrid(shiftId: string) {
    const source = this.shift(shiftId);
    await source.scrollIntoViewIfNeeded();
    const box = await source.boundingBox();
    if (!box) throw new Error('Shift not found for drag-off-grid');
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(10, 10, { steps: 10 });
    await this.page.mouse.up();
  }

  private async dragToTarget(source: Locator, target: Locator) {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('Unable to calculate schedule drag target');
    }

    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;
    const tx = targetBox.x + targetBox.width / 2;
    const ty = targetBox.y + targetBox.height / 2;

    // Hover over the source to ensure the mouse is positioned on the drag handle.
    // hello-pangea/dnd requires the mousedown to target the drag-handle element.
    await source.hover({ force: true, position: { x: sourceBox.width / 2, y: sourceBox.height / 2 } });
    await this.page.waitForTimeout(80);
    await this.page.mouse.down();
    await this.page.waitForTimeout(150);
    await this.page.mouse.move(tx, ty, { steps: 30 });
    await this.page.waitForTimeout(200);
    await this.page.mouse.up();
    await this.page.waitForTimeout(1200);
  }
}
