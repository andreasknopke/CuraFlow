import { expect, type Page } from '@playwright/test';

export async function expectNoDatabaseProblemToast(page: Page) {
  const toast = page.getByText('Datenbankproblem', { exact: true });
  await expect(toast).not.toBeVisible();
  await page.waitForTimeout(250);
  await expect(toast).not.toBeVisible();
}
