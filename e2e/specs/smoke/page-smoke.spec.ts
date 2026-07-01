import { expect, test } from '../../fixtures/auth';
import { storageStatePaths } from '../../support/config';

const PAGE_SMOKE_TESTS: { name: string; url: string; testid: string }[] = [
  { name: 'Home', url: '/home', testid: 'home-page' },
  { name: 'Help', url: '/help', testid: 'help-page' },
  { name: 'MyDashboard', url: '/mydashboard', testid: 'mydashboard-page' },
  { name: 'DataImport', url: '/dataimport', testid: 'dataimport-page' },
  { name: 'ServiceStaffing', url: '/servicestaffing', testid: 'servicestaffing-page' },
];

test.describe('page smoke tests', () => {
  test.use({ storageState: storageStatePaths.admin });

  for (const { name, url, testid } of PAGE_SMOKE_TESTS) {
    test(`${name} page renders without errors`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.stack || error.message);
      });

      await page.goto(url);
      await expect(page.getByTestId(testid)).toBeVisible({ timeout: 10000 });

      if (pageErrors.length > 0) {
        throw new Error(`Page errors on ${name}:\n${pageErrors.join('\n\n')}`);
      }
    });
  }

  test('CertificateUpload page renders with placeholder token', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.stack || error.message);
    });

    // CertificateUpload page doesn't validate the token on the client side.
    await page.goto('/upload/missing-or-expired-token');
    await expect(page.getByTestId('certificate-upload-page')).toBeVisible({ timeout: 10000 });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors on CertificateUpload:\n${pageErrors.join('\n\n')}`);
    }
  });
});
