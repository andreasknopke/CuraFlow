import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/auth';
import { seededSchedule, storageStatePaths } from '../../support/config';

function capturePageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.stack || error.message);
  });
  return errors;
}

test.describe('schedule board safety tests', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('auto-fill: generates preview and can discard it', async ({
    page,
    schedulePage,
  }) => {
    await schedulePage.goto(seededSchedule.focusDate, 'week');

    await schedulePage.autoFillTrigger.click();
    await expect(schedulePage.autoFillAll).toBeVisible();
    await schedulePage.autoFillAll.click();

    await expect(schedulePage.previewBar).toBeVisible({ timeout: 25000 });

    const countText = await schedulePage.previewBar.textContent();
    expect(countText).toMatch(/Vorschläge/);

    await schedulePage.previewDiscardButton.click();
    await expect(schedulePage.previewBar).not.toBeVisible();
  });

  test('seeded shifts render and survive view switching', async ({
    page,
    schedulePage,
  }) => {
    await schedulePage.goto(seededSchedule.focusDate, 'week');

    const errors = capturePageErrors(page);

    await expect(schedulePage.shift(seededSchedule.shiftIds.foreground)).toBeVisible();
    await expect(schedulePage.shift(seededSchedule.shiftIds.background)).toBeVisible();
    await expect(schedulePage.shift(seededSchedule.shiftIds.ct)).toBeVisible();
    await expect(schedulePage.shift(seededSchedule.shiftIds.mrt)).toBeVisible();
    await expect(
      schedulePage.qualificationWarning(seededSchedule.shiftIds.ct),
    ).toBeVisible();

    // Switch to month view and back to week — verify no crashes
    await schedulePage.openMonthView();
    await schedulePage.openWeekView();

    // Navigate to next period and back
    await schedulePage.goToNextPeriod();
    await schedulePage.goToPreviousPeriod();

    expect(errors).toHaveLength(0);
  });

  test('clear-day buttons are visible for each day in week view', async ({
    page,
    schedulePage,
  }) => {
    await schedulePage.goto(seededSchedule.focusDate, 'week');

    const errors = capturePageErrors(page);

    // Verify clear-day buttons exist for each seeded shift date
    const dates = ['2026-05-05', '2026-05-06'];
    for (const date of dates) {
      const btn = page.getByTestId(`schedule-day-clear-${date}`);
      await expect(btn).toBeVisible();
    }

    expect(errors).toHaveLength(0);
  });

  test('toolbar elements are all present', async ({
    page,
    schedulePage,
  }) => {
    await schedulePage.goto(seededSchedule.focusDate, 'week');

    const errors = capturePageErrors(page);

    await expect(schedulePage.undoButton).toBeVisible();
    await expect(schedulePage.autoFillTrigger).toBeVisible();
    await expect(schedulePage.monthViewButton).toBeVisible();
    await expect(schedulePage.weekViewButton).toBeVisible();
    await expect(schedulePage.dayViewButton).toBeVisible();
    await expect(schedulePage.previousPeriodButton).toBeVisible();
    await expect(schedulePage.nextPeriodButton).toBeVisible();
    await expect(schedulePage.currentPeriodLabel).toBeVisible();

    // Export and clear-week exist but depend on seeded data being present
    const exportBtn = page.getByTestId('schedule-export');
    await expect(exportBtn).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('no database problem toast on schedule page', async ({
    page,
    schedulePage,
  }) => {
    await schedulePage.goto(seededSchedule.focusDate, 'week');

    await expect(
      page.getByText('Datenbankproblem', { exact: true }),
    ).toHaveCount(0);
  });
});
