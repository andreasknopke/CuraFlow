import { addMonths, format, startOfMonth } from 'date-fns';
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth';
import {
  dbDelete,
  dbFilter,
  dbRequest,
  getAuthHeaders,
  type DbAuthHeaders,
} from '../../support/api';
import { storageStatePaths } from '../../support/config';

type ShiftEntry = {
  id: string;
  doctor_id: string;
  date: string;
  position: string;
};

function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });
  return pageErrors;
}

function assertNoPageErrors(pageErrors: string[]) {
  if (pageErrors.length > 0) {
    throw new Error(`Unexpected page errors:\n${pageErrors.join('\n\n')}`);
  }
}

async function deleteDoctorDayShifts(
  request: Parameters<typeof dbFilter>[0],
  authHeaders: DbAuthHeaders,
  doctorId: string,
  date: string
) {
  const shifts = await dbFilter<ShiftEntry>(request, authHeaders, 'ShiftEntry', {
    doctor_id: doctorId,
    date,
  });

  for (const shift of shifts) {
    await dbDelete(request, authHeaders, 'ShiftEntry', shift.id);
  }
}

test.describe('vacation workflows', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('an admin can resolve a service conflict when assigning vacation', async ({
    page,
    request,
    vacationPage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded vacation state across browser projects.');

    const doctorId = 'doctor-anna';
    // Use a future date (first day of the month after the current month).
    // The vacation calendar hides non-Tisoware-confirmed absences on past/today
    // dates, so we must always pick a date that is guaranteed to be in the future
    // regardless of when the test suite runs.
    const date = addMonths(startOfMonth(new Date()), 1);
    const dateString = format(date, 'yyyy-MM-dd');
    const pageErrors = capturePageErrors(page);

    let authHeaders: DbAuthHeaders | null = null;

    try {
      await vacationPage.goto();
      authHeaders = await getAuthHeaders(page);
      await deleteDoctorDayShifts(request, authHeaders, doctorId, dateString);

      await dbRequest(request, authHeaders, {
        action: 'create',
        table: 'ShiftEntry',
        data: {
          date: dateString,
          doctor_id: doctorId,
          order: 91,
          position: 'Dienst Vordergrund',
        },
      });
      await page.waitForTimeout(500);

      await page.reload();
      await vacationPage.expectLoaded();

      await vacationPage.setDisplayedYear(date.getFullYear());
      await vacationPage.selectDoctor(doctorId);
      await vacationPage.selectAbsenceType('urlaub');
      await vacationPage.assignAbsenceOnDate(dateString);

      await expect(vacationPage.conflictDialog).toContainText('Dienst Vordergrund');
      await vacationPage.confirmConflict();

      await expect
        .poll(async () => await vacationPage.dayCell(dateString).getAttribute('title'), { timeout: 10000 })
        .toContain('Urlaub');

      await expect
        .poll(async () => {
          const shifts = await dbFilter<ShiftEntry>(request, authHeaders!, 'ShiftEntry', {
            doctor_id: doctorId,
            date: dateString,
          });
          return shifts.map((shift) => shift.position).sort();
        })
        .toEqual(['Urlaub']);

      assertNoPageErrors(pageErrors);
    } finally {
      if (authHeaders) {
        await deleteDoctorDayShifts(request, authHeaders, doctorId, dateString);
      }
    }
  });
});
