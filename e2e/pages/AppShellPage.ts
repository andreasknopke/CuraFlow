import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoDatabaseProblemToast } from '../support/uiAssertions';

export class AppShellPage {
  readonly shell: Locator;
  readonly sidebar: Locator;
  readonly openSidebarButton: Locator;
  readonly adminLink: Locator;
  readonly staffLink: Locator;
  readonly schedulePage: Locator;
  readonly adminPage: Locator;
  readonly staffPage: Locator;
  readonly readonlyBadge: Locator;
  readonly accountMenuTrigger: Locator;
  readonly logoutButton: Locator;
  readonly adminAccessDenied: Locator;

  constructor(private readonly page: Page) {
    this.shell = page.getByTestId('app-shell');
    this.sidebar = page.getByTestId('app-sidebar');
    this.openSidebarButton = page.getByTestId('sidebar-open-button');
    this.adminLink = page.getByTestId('nav-link-admin');
    this.staffLink = page.getByTestId('nav-link-staff');
    this.schedulePage = page.getByTestId('schedule-page');
    this.adminPage = page.getByTestId('admin-page');
    this.staffPage = page.getByTestId('staff-page');
    this.readonlyBadge = page.getByTestId('readonly-mode-badge');
    this.accountMenuTrigger = page.getByTestId('account-menu-trigger');
    this.logoutButton = page.getByTestId('account-menu-logout');
    this.adminAccessDenied = page.getByTestId('admin-access-denied');
  }

  async expectReady() {
    await expect(this.shell).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async expectOnSchedulePage() {
    await this.expectReady();
    await expect(this.page).toHaveURL(/\/schedule(?:\?|$)/);
    await expect(this.schedulePage).toBeVisible();
  }

  async ensureSidebarOpen() {
    if (await this.openSidebarButton.isVisible().catch(() => false)) {
      await this.openSidebarButton.click();
    }

    await expect(this.sidebar).toBeVisible();
  }

  async gotoAdmin() {
    await this.ensureSidebarOpen();
    await this.adminLink.click();
    await expect(this.page).toHaveURL(/\/admin(?:\?|$)/);
    await expect(this.adminPage).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async gotoStaff() {
    await this.ensureSidebarOpen();
    await this.staffLink.click();
    await expect(this.page).toHaveURL(/\/staff(?:\?|$)/);
    await expect(this.staffPage).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async logout() {
    // account-menu-logout renders in a Radix Portal that mounts lazily once the
    // menu opens. On Firefox the menu can auto-dismiss mid-click when a
    // background re-render (SSE reconnect / query refetch in
    // PlanUpdateListener) closes it before the onClick handler fires, so the
    // navigation goes to the current page instead of /authlogin. Retry the
    // open+click until the handler confirms it ran by navigating away.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.accountMenuTrigger.click();
      try {
        await this.logoutButton.click({ timeout: 5_000 });
      } catch {
        continue;
      }
      const navigated = await this.page
        .waitForURL(/\/authlogin(?:\?|$)/, { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (navigated) return;
    }
    await this.page.waitForURL(/\/authlogin(?:\?|$)/, { timeout: 20_000 });
  }
}
