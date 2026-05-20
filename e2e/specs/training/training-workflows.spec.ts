import { addDays, format } from 'date-fns';
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth';
import {
  dbDelete,
  dbFilter,
  getAuthHeaders,
  type DbAuthHeaders,
} from '../../support/api';
import { storageStatePaths } from '../../support/config';

type TrainingRotation = {
  id: string;
  doctor_id: string;
  start_date: string;
  end_date: string;
  modality: string | null;
};

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

function getNextBusinessDayAfter(date: Date) {
  const candidate = addDays(new Date(date), 1);
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

async function deleteMatchingRotations(
  request: Parameters<typeof dbFilter>[0],
  authHeaders: DbAuthHeaders,
  doctorId: string,
  startDate: string,
  endDate: string,
  modality: string
) {
  const rotations = await dbFilter<TrainingRotation>(request, authHeaders, 'TrainingRotation', {
    doctor_id: doctorId,
  });

  for (const rotation of rotations) {
    if (rotation.modality === modality && rotation.start_date === startDate && rotation.end_date === endDate) {
      await dbDelete(request, authHeaders, 'TrainingRotation', rotation.id);
    }
  }
}

async function deleteMatchingShift(
  request: Parameters<typeof dbFilter>[0],
  authHeaders: DbAuthHeaders,
  doctorId: string,
  date: string,
  position: string
) {
  const shifts = await dbFilter<ShiftEntry>(request, authHeaders, 'ShiftEntry', {
    doctor_id: doctorId,
    date,
    position,
  });

  for (const shift of shifts) {
    await dbDelete(request, authHeaders, 'ShiftEntry', shift.id);
  }
}

test.describe('training workflows', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('an admin can create a rotation and transfer it into the schedule', async ({
    page,
    request,
    trainingPage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded training state across browser projects.');

    const doctorId = 'doctor-clara';
    const modality = 'Sono Rotation';
    const startDate = new Date();
    const transferDate = getNextBusinessDayAfter(startDate);
    const startDateString = format(startDate, 'yyyy-MM-dd');
    const transferDateString = format(transferDate, 'yyyy-MM-dd');
    const usesFromDateTransfer = startDate.getDay() === 0 || startDate.getDay() === 6;
    const expectedShiftDate = usesFromDateTransfer ? transferDateString : startDateString;
    const pageErrors = capturePageErrors(page);

    let authHeaders: DbAuthHeaders | null = null;

    try {
      await trainingPage.goto();
      authHeaders = await getAuthHeaders(page);

      await deleteMatchingRotations(request, authHeaders, doctorId, startDateString, transferDateString, modality);
      await deleteMatchingShift(request, authHeaders, doctorId, expectedShiftDate, modality);

      await trainingPage.setDisplayedYear(startDate.getFullYear());
      await trainingPage.selectDoctor(doctorId);
      await trainingPage.selectModality('sono-rotation');
      await trainingPage.createRotationRange(startDateString, transferDateString);

      await expect
        .poll(async () => {
          const rotations = await dbFilter<TrainingRotation>(request, authHeaders!, 'TrainingRotation', {
            doctor_id: doctorId,
          });

          return rotations.some((rotation) =>
            rotation.modality === modality
            && rotation.start_date === startDateString
            && rotation.end_date === transferDateString
          );
        })
        .toBe(true);

      await trainingPage.openTransferDialog();
      if (usesFromDateTransfer) {
        await trainingPage.chooseTransferMode('from-date');
      }

      await expect(trainingPage.transferPreviewButton).toHaveText(/\([1-9]/);
      await trainingPage.showTransferPreview();
      await expect(trainingPage.transferDialog.getByText(modality, { exact: true })).toBeVisible();
      await expect(trainingPage.transferDialog.getByText('Clara Conrad', { exact: true })).toBeVisible();
      await expect(trainingPage.transferConfirmButton).toBeVisible();
      await trainingPage.confirmTransfer();

      await expect
        .poll(async () => {
          const shifts = await dbFilter<ShiftEntry>(request, authHeaders!, 'ShiftEntry', {
            doctor_id: doctorId,
            date: expectedShiftDate,
            position: modality,
          });

          return shifts.length;
        })
        .toBe(1);

      assertNoPageErrors(pageErrors);
    } finally {
      if (authHeaders) {
        await deleteMatchingShift(request, authHeaders, doctorId, expectedShiftDate, modality);
        await deleteMatchingRotations(request, authHeaders, doctorId, startDateString, transferDateString, modality);
      }
    }
  });
});
