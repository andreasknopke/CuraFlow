import { test as base, expect } from '@playwright/test';

import { AppShellPage } from '../pages/AppShellPage';
import { LoginPage } from '../pages/LoginPage';
import { SchedulePage } from '../pages/SchedulePage';

type E2EFixtures = {
  appShell: AppShellPage;
  loginPage: LoginPage;
  schedulePage: SchedulePage;
};

const e2eTest = base.extend<E2EFixtures>({
  appShell: async ({ page }, use) => {
    await use(new AppShellPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  schedulePage: async ({ page }, use) => {
    await use(new SchedulePage(page));
  },
});

export const test = e2eTest;
export { expect };
