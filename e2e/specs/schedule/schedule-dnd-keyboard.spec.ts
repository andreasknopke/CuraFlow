/**
 * SPIKE — diagnostic proving keyboard-DnD CANNOT reliably create a schedule
 * shift, even with the input-dispatch problem fully solved.
 *
 * INVESTIGATION SUMMARY (2026-07-04, against the Docker e2e harness):
 *
 *  Three distinct problems were isolated and solved/characterized:
 *
 *  1. INPUT DISPATCH — SOLVED. Playwright's `page.keyboard.press('Space')`
 *     synthesizes a click on the focused `<div role="button">` handle, and
 *     pangea cancels any in-progress drag on click (use-keyboard-sensor.ts).
 *     Also, `new KeyboardEvent(...)` leaves `keyCode=0`, but pangea reads
 *     `event.keyCode`, so synthetic events were ignored. Fix: dispatch raw
 *     `KeyboardEvent`s on `document.activeElement` with `keyCode`/`which`
 *     overridden via `Object.defineProperty`. This makes lift, move, AND drop
 *     fire correctly (`Drag Start` → move keys → `Drag Operation Ended`, and
 *     `handleDragEnd` runs validation).
 *
 *  2. ARROW-RIGHT CANCELS — CHARACTERIZED. After any arrow move, focus leaves
 *     the handle (lands on `<body>`). A subsequent drop-Space synthesized via
 *     `keyboard.press` produces a click on `<body>`, which pangea treats as a
 *     cancel. The raw-KeyboardEvent approach sidesteps this entirely (no
 *     click synthesis), which is why it works where `keyboard.press` didn't.
 *
 *  3. SPATIAL NAVIGATION — BLOCKER (not fixable without a library change).
 *     With lift/move/drop all working, the drop still never lands on the
 *     target row. Pangea's `moveCrossAxis` (state/move-in-direction/index.ts)
 *     resolves the next droppable by nearest center-distance from the
 *     dragged item's start position. The sidebar sits left of the grid; its
 *     vertical center aligns with the Abwesenheiten ("Urlaub") section, so
 *     ArrowRight/ArrowDown always resolve to an Abwesenheiten cell. A 2-D
 *     sweep (ArrowDown 0..7 × ArrowRight 0..3) and pre-scrolling the target
 *     cell into view both failed — every drop landed on `Pos=Urlaub`, never
 *     on `Dienst Vordergrund`. This is intrinsic to @hello-pangea/dnd's
 *     keyboard movement + this grid's layout.
 *
 * CONCLUSION: keyboard DnD cannot drive ScheduleBoard's create path. The
 * existing mouse helpers also fail (`destination: null`). Phase 3 stays High
 * risk. The raw-KeyboardEvent dispatch technique documented here is retained
 * for any future attempt (e.g. if @hello-pangea/dnd is replaced by a library
 * with deterministic keyboard navigation such as dnd-kit).
 *
 *   npx playwright test e2e/specs/schedule/schedule-dnd-keyboard.spec.ts --project=chromium
 */

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth';
import { dbDelete, dbFilter, getAuthHeaders, type DbAuthHeaders } from '../../support/api';
import { seededSchedule, storageStatePaths } from '../../support/config';

type ShiftEntry = { id: string; doctor_id: string; date: string; position: string };

const DOCTOR_ID = 'doctor-emma';
const DATE = `${seededSchedule.targetMonth}-07`;
const POSITION = 'Dienst Vordergrund';

function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });
  return pageErrors;
}

async function cleanDoctorDayShifts(
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

test.describe('SPIKE: schedule keyboard drag-and-drop (diagnostic)', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('keyboard DnD lifts and drops but cannot navigate onto Dienst Vordergrund', async ({
    page,
    request,
    schedulePage,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'This flow mutates shared seeded schedule state across browser projects.'
    );

    const pageErrors = capturePageErrors(page);

    // Stringify object console args so the drag-end result is readable.
    await page.evaluate(() => {
      const orig = console.log.bind(console);
      console.log = (...args: unknown[]) =>
        orig(
          ...args.map((a) => {
            try {
              return a && typeof a === 'object' ? JSON.stringify(a) : a;
            } catch {
              return a;
            }
          })
        );
    });
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(msg.text()));

    let authHeaders: DbAuthHeaders | null = null;

    try {
      await schedulePage.goto(seededSchedule.focusDate, 'week');
      authHeaders = await getAuthHeaders(page);
      await cleanDoctorDayShifts(request, authHeaders, DOCTOR_ID, DATE);
      await page.reload();
      await schedulePage.expectLoaded();

      const handle = schedulePage.sidebarDoctorHandle(DOCTOR_ID);
      await handle.scrollIntoViewIfNeeded();

      // Dispatch a real KeyboardEvent with the legacy keyCode pangea reads.
      // `page.keyboard.press` synthesizes a click that cancels the drag; raw
      // dispatch avoids that and lets lift/move/drop all fire.
      const pressKey = async (key: string) => {
        await page.evaluate((k: string) => {
          const codes: Record<string, number> = {
            ' ': 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Escape: 27,
          };
          const code = codes[k] ?? 0;
          const target = document.activeElement || document.body;
          const mk = (type: 'keydown' | 'keyup') => {
            const ev = new KeyboardEvent(type, {
              key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true,
            });
            Object.defineProperty(ev, 'keyCode', { get: () => code });
            Object.defineProperty(ev, 'which', { get: () => code });
            return ev;
          };
          target.dispatchEvent(mk('keydown'));
          target.dispatchEvent(mk('keyup'));
        }, key);
        await page.waitForTimeout(40);
      };

      // 2-D sweep of (ArrowDown × ArrowRight). The drop reaches handleDragEnd
      // (validation logs fire) but always lands on the Abwesenheiten ("Urlaub")
      // row, never on Dienst Vordergrund — pangea's moveCrossAxis resolves the
      // nearest droppable by center-distance and the sidebar aligns with the
      // Abwesenheiten section.
      let anyOnTarget = false;
      for (let downs = 0; downs < 8 && !anyOnTarget; downs += 1) {
        for (let rights = 0; rights < 4 && !anyOnTarget; rights += 1) {
          await cleanDoctorDayShifts(request, authHeaders, DOCTOR_ID, DATE);
          const baseline = consoleLines.length;

          await handle.focus();
          await pressKey(' '); // lift
          for (let i = 0; i < downs; i += 1) await pressKey('ArrowDown');
          for (let i = 0; i < rights; i += 1) await pressKey('ArrowRight');
          await pressKey(' '); // drop
          await page.waitForTimeout(150);

          const valLine = consoleLines
            .slice(baseline)
            .find((l) => /Validating:/.test(l));
          const pos = valLine?.match(/Pos=(\S+)/)?.[1] ?? 'none';
          if (pos === POSITION) anyOnTarget = true;
        }
      }

      // Diagnostic assertion: documents that keyboard DnD cannot navigate
      // onto the target row. If this ever flips to true, revisit Pre-PR 3.0A.
      expect(anyOnTarget, 'keyboard DnD unexpectedly reached Dienst Vordergrund').toBe(false);

      expect(pageErrors, JSON.stringify(pageErrors)).toEqual([]);
    } finally {
      if (authHeaders) {
        await cleanDoctorDayShifts(request, authHeaders, DOCTOR_ID, DATE);
      }
    }
  });
});
