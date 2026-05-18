import type { APIRequestContext, Page } from '@playwright/test';

import { backendURL, storageStatePaths } from '../../support/config';
import { expect, test } from '../../fixtures/auth';

function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

async function fetchCurrentUser(page: Page, request: APIRequestContext) {
  const token = await page.evaluate(() => localStorage.getItem('radioplan_jwt_token'));
  expect(token).toBeTruthy();

  const response = await request.get(`${backendURL}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe('auth workflows', () => {
  test('allows an admin to log out from the account menu', async ({ appShell, loginPage, page }) => {
    await loginPage.goto();
    await loginPage.signInAsAdmin();
    await appShell.expectReady();
    await expect(appShell.accountMenuTrigger).toBeVisible();

    await expect.poll(async () => page.evaluate(() => localStorage.getItem('db_token_enabled'))).toBe('true');

    const authState = await page.evaluate(() => ({
      jwtToken: localStorage.getItem('radioplan_jwt_token'),
      dbCredentials: localStorage.getItem('db_credentials'),
    }));

    expect(authState.jwtToken).toBeTruthy();
    expect(authState.dbCredentials).toBeTruthy();

    await appShell.logout();
    await loginPage.expectLoaded();

    const clearedState = await page.evaluate(() => ({
      jwtToken: localStorage.getItem('radioplan_jwt_token'),
      dbTokenEnabled: localStorage.getItem('db_token_enabled'),
      dbCredentials: localStorage.getItem('db_credentials'),
      activeTokenId: localStorage.getItem('active_token_id'),
    }));

    expect(clearedState.jwtToken).toBeNull();
    expect(clearedState.dbTokenEnabled).toBe('false');
    expect(clearedState.activeTokenId).toBeNull();
    expect(clearedState.dbCredentials).toBeTruthy();
  });

  test.describe('read-only user', () => {
    test.use({ storageState: storageStatePaths.user });

    test('shows read-only mode and blocks admin access', async ({ appShell, page, request }) => {
      const pageErrors = capturePageErrors(page);

      await page.goto('/schedule');
      await appShell.expectOnSchedulePage();
      await expect(appShell.readonlyBadge).toBeVisible();
      await expect(appShell.adminLink).toHaveCount(0);

      const me = await fetchCurrentUser(page, request);
      expect(me.role).toBe('user');
      expect(me.must_change_password).toBe(false);

      await page.goto('/admin');
      await expect(appShell.adminAccessDenied).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  });

  test('forces a readonly user to change the temporary password', async ({
    appShell,
    browserName,
    loginPage,
    page,
    request,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded credentials across browser projects.');
    const updatedPassword = 'readonly-updated-123';

    await loginPage.goto();
    await loginPage.signInAsReadonly();

    const forcePasswordDialog = page.getByTestId('force-password-dialog');
    await expect(forcePasswordDialog).toBeVisible();
    await page.getByTestId('force-password-new').fill(updatedPassword);
    await page.getByTestId('force-password-confirm').fill(updatedPassword);
    await page.getByTestId('force-password-submit').click();

    await expect(forcePasswordDialog).not.toBeVisible();
    await expect(appShell.readonlyBadge).toBeVisible();

    const me = await fetchCurrentUser(page, request);
    expect(me.role).toBe('readonly');
    expect(me.must_change_password).toBe(false);
  });
});
