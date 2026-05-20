import { test as base, expect } from '@playwright/test';

import { AppShellPage } from '../pages/AppShellPage';
import { AdminPage } from '../pages/AdminPage';
import { LoginPage } from '../pages/LoginPage';
import { StaffPage } from '../pages/StaffPage';
import { StatisticsPage } from '../pages/StatisticsPage';
import { SchedulePage } from '../pages/SchedulePage';

type E2EFixtures = {
  appShell: AppShellPage;
  adminPage: AdminPage;
  loginPage: LoginPage;
  staffPage: StaffPage;
  statisticsPage: StatisticsPage;
  schedulePage: SchedulePage;
};

const e2eTest = base.extend<E2EFixtures>({
  appShell: async ({ page }, use) => {
    await use(new AppShellPage(page));
  },
  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  schedulePage: async ({ page }, use) => {
    await use(new SchedulePage(page));
  },
  staffPage: async ({ page }, use) => {
    await use(new StaffPage(page));
  },
  statisticsPage: async ({ page }, use) => {
    await use(new StatisticsPage(page));
  },
});

export const test = e2eTest;
export { expect };
