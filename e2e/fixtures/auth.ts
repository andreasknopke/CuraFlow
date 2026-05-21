import { test as base, expect } from '@playwright/test';

import { AppShellPage } from '../pages/AppShellPage';
import { LoginPage } from '../pages/LoginPage';
import { StaffPage } from '../pages/StaffPage';
import { SchedulePage } from '../pages/SchedulePage';
import { WishListPage } from '../pages/WishListPage';
import { VacationPage } from '../pages/VacationPage';
import { TrainingPage } from '../pages/TrainingPage';

type E2EFixtures = {
  appShell: AppShellPage;
  loginPage: LoginPage;
  staffPage: StaffPage;
  schedulePage: SchedulePage;
  wishListPage: WishListPage;
  vacationPage: VacationPage;
  trainingPage: TrainingPage;
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
  staffPage: async ({ page }, use) => {
    await use(new StaffPage(page));
  },
  wishListPage: async ({ page }, use) => {
    await use(new WishListPage(page));
  },
  vacationPage: async ({ page }, use) => {
    await use(new VacationPage(page));
  },
  trainingPage: async ({ page }, use) => {
    await use(new TrainingPage(page));
  },
});

export const test = e2eTest;
export { expect };
