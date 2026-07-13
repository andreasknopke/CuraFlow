/**
 * SPIKE — not a permanent regression test.
 *
 * Question this file answers:
 *   Can `@hello-pangea/dnd` actually fire `onDragEnd` inside the project's
 *   `component` Vitest project (environment: happy-dom)?
 *
 *   The TypeScript Conversion Plan (Pre-PR 3.0A) reduces ScheduleBoard's
 *   conversion risk from High → Medium on the ASSUMPTION that a 19-case DnD
 *   component suite can be written against this environment. hello-pangea/dnd
 *   (like react-beautiful-dnd) drives its drag lifecycle off real DOM layout
 *   (`getBoundingClientRect`) and live mousemove listeners on `window`. Neither
 *   happy-dom nor jsdom performs CSS layout, so `getBoundingClientRect` returns
 *   all-zeros and pangea cannot resolve which droppable the pointer is over →
 *   `onDragEnd` fires with `destination: null` or never fires.
 *
 *   This file attempts the real thing: render ScheduleBoard, stub layout on the
 *   drag handle and target cell, dispatch a mousedown→mousemove→mouseup
 *   sequence, and assert the shift actually gets created.
 *
 * How to read the result:
 *   - If the "sanity" assertions pass (board + sidebar doctor + cell render)
 *     but the drag assertion FAILS → the plan's assumption is wrong. Pre-PR 3.0A
 *     as written cannot work; ScheduleBoard conversion stays High risk and must
 *     rely on the keyboard-driven e2e suite instead.
 *   - If everything passes → assumption holds; Pre-PR 3.0A can proceed.
 *
 * Run:  npx vitest run --project component src/components/schedule/__component_tests__/ScheduleDragDrop.spike.test.jsx
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import ScheduleBoard from '@/components/schedule/ScheduleBoard';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import {
  createAuthHandlers,
  createDbHandlers,
  createRouteHandler,
  server,
} from '@/test-utils/server';

// AuthProvider hands the presence heartbeat to `POST /api/auth/presence`; the
// db handlers below cover the POST /api/db traffic. Any other GET the board or
// its imported hooks fire is caught by a permissive catch-all so an unrelated
// missing endpoint does not muddy the DnD signal (`onUnhandledRequest` is
// 'error' globally).
const catchAllGet = createRouteHandler('get', '*/api/*', () =>
  // Array shape is safe for list consumers; object consumers in the board
  // (e.g. my-groups → { groups }) read optional chains and tolerate [].
  Response.json([])
);

// give AuthProvider a stored token so it hydrates as authenticated on mount
const ADMIN_USER = {
  id: 'user-admin',
  email: 'admin@test.local',
  role: 'admin',
  must_change_password: false,
};

function seedAdminToken() {
  localStorage.setItem('radioplan_jwt_token', 'stored-test-token');
}

// Minimal seed: one writable service workplace (category 'Dienste' so it lands
// in the rendered "Dienste" section) and one doctor. No shifts — the drag under
// test creates the first one.
function renderBoardWithSeed() {
  const entities = {
    Doctor: [
      { id: 'doc-1', name: 'Anna Adler', initials: 'AA', active: true },
    ],
    Workplace: [
      { id: 'wp-1', name: 'Notaufnahme', category: 'Dienste', order: 1, canWrite: true },
    ],
    WorkplaceTimeslot: [],
    SystemSetting: [],
    StaffingPlanEntry: [],
    ShiftEntry: [],
    WishRequest: [],
    TrainingRotation: [],
    ColorSetting: [],
    ScheduleNote: [],
    ScheduleBlock: [],
    Qualification: [],
    DoctorQualification: [],
    WorkplaceQualification: [],
    TeamRole: [],
    Holiday: [],
  };

  server.use(
    ...createDbHandlers({ entities }),
    ...createAuthHandlers({ user: ADMIN_USER }),
    createRouteHandler('get', '*/api/auth/my-groups', () =>
      Response.json({ groups: [] })
    ),
    createRouteHandler('post', '*/api/auth/presence', () =>
      Response.json({ success: true })
    ),
    catchAllGet
  );

  return renderWithProviders(<ScheduleBoard />, {
    route: '/schedule?view=week&date=2026-07-06',
    withAuthProvider: true,
    withToaster: true,
  });
}

/**
 * happy-dom returns all-zeros rects, which prevents pangea/dnd from resolving a
 * drop target. We pin believable rects on the source handle and target cell so
 * the library has real coordinates to work with.
 */
function pinLayout(sourceHandle: any, targetCell: any) {
  const handleRect = { x: 10, y: 10, width: 40, height: 40, top: 10, left: 10, right: 50, bottom: 50 } as DOMRect;
  const cellRect = { x: 200, y: 200, width: 80, height: 60, top: 200, left: 200, right: 280, bottom: 260 } as DOMRect;

  sourceHandle.getBoundingClientRect = () => handleRect;
  targetCell.getBoundingClientRect = () => cellRect;
  // pangea also reads the dragged element's rect during the gesture.
  const draggables = document.querySelectorAll('[data-testid^="schedule-sidebar-doctor-"]');
  draggables.forEach((el) => {
    el.getBoundingClientRect = () => handleRect;
  });
}

// The drag test is permanently skipped — the spike proved that
// @hello-pangea/dnd cannot resolve drop destinations in happy-dom
// (no CSS layout engine). See TYPESCRIPT_CONVERSION_PLAN.md Pre-PR 3.0A.
describe.skip('SPIKE: ScheduleBoard drag-and-drop in happy-dom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the board, a sidebar doctor, and a droppable service cell (sanity)', async () => {
    seedAdminToken();
    renderBoardWithSeed();

    // Board mount + toolbar present → queries resolved, MSW loop is healthy.
    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    // Sidebar doctor chip exists → DraggableDoctor mounted inside DragDropContext.
    expect(await screen.findByTestId('schedule-sidebar-doctor-doc-1')).toBeInTheDocument();

    // At least one service cell is droppable → DroppableCell mounted.
    const cell = document.querySelector('[data-testid^="schedule-cell-"]');
    expect(cell, 'expected at least one schedule-cell-* element').not.toBeNull();
  });

  it('creates a shift when a sidebar doctor is dragged onto an empty cell', async () => {
    seedAdminToken();
    const { queryClient } = renderBoardWithSeed();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();
    // Sidebar doctor renders → the Draggable mounted and is ready to be dragged.
    await screen.findByTestId('schedule-sidebar-doctor-doc-1');
    const handle = screen.getByTestId('schedule-sidebar-doctor-handle-doc-1');

    const cell = document.querySelector('[data-testid^="schedule-cell-"]');
    expect(cell).not.toBeNull();
    const cellTestId = cell!.getAttribute('data-testid');

    pinLayout(handle, cell);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Capture whether the window-level pointer listeners pangea registers on
    // drag-start ever actually fire. If they don't, the gesture never began.
    let moveEventsReachedWindow = 0;
    const windowMoveListener = () => {
      moveEventsReachedWindow += 1;
    };
    window.addEventListener('mousemove', windowMoveListener, { capture: true });

    // Replicate the pangea/dnd mouse gesture: press on the handle, move to the
    // cell centre, release. Listeners live on `window`; dispatch on document so
    // the events bubble up to window.
    fireEvent.mouseDown(handle, { clientX: 10, clientY: 10, button: 0 });
    for (let step = 1; step <= 10; step += 1) {
      fireEvent.mouseMove(document, {
        clientX: 10 + ((240 - 10) * step) / 10,
        clientY: 10 + ((230 - 10) * step) / 10,
      });
    }
    fireEvent.mouseUp(document, { clientX: 240, clientY: 230 });

    window.removeEventListener('mousemove', windowMoveListener, { capture: true });

    // Decisive signals, reported in the failure message so the result is
    // unambiguous: (1) did onDragEnd run (invalidate called)? (2) did the chip
    // appear? A pass requires both. A fail with moveEventsReachedWindow === 0
    // means pangea never started the drag → environment limitation confirmed.
    let chip = null;
    try {
      chip = await waitFor(() => {
        const found = document.querySelector('[data-testid^="schedule-shift-"]');
        if (!found) throw new Error('no chip');
        return found;
      }, { timeout: 3000 });
    } catch {
      // Surface WHY it failed in the assertion message — this is a spike, the
      // diagnostic matters more than the matcher.
      const invalidateCalls = invalidateSpy.mock.calls.length;
      throw new Error(
        `DRAG DID NOT CREATE A SHIFT.\n` +
          `  moveEventsReachedWindow=${moveEventsReachedWindow}\n` +
          `  invalidateQueries calls=${invalidateCalls} (onDragEnd reached only if > 0)\n` +
          `  cellTestId=${cellTestId}\n` +
          (moveEventsReachedWindow === 0
            ? '  → pangea never started the drag (no window mousemove). happy-dom/jsdom cannot drive @hello-pangea/dnd.'
            : '  → pangea saw movement but did not resolve a drop destination.')
      );
    }

    expect(chip).toBeInTheDocument();
    expect(cellTestId).toMatch(/^schedule-cell-/);
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
