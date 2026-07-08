/**
 * Pre-PR 3.0B — ScheduleBoard rendering component tests.
 *
 * These tests verify that ScheduleBoard renders correctly with seeded data,
 * switches views, displays section headers, shows qualification warnings,
 * and exposes auto-fill trigger / undo UI. They protect Phase 3 TypeScript
 * conversion (ScheduleBoard.jsx → .tsx) against rendering regressions.
 *
 * DnD interactions are NOT tested here (infeasible in happy-dom; see
 * ScheduleDragDrop.spike.test.jsx for evidence).
 *
 * Run:  npx vitest run --project component src/components/schedule/__component_tests__/ScheduleBoardRender.test.jsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test-utils/renderWithProviders';
import {
  createAuthHandlers,
  createDbHandlers,
  createRouteHandler,
  server,
} from '@/test-utils/server';

// ---------------------------------------------------------------------------
// Mock DropdownMenu to render inline — the Radix portal and trigger event
// handling are not reliable in happy-dom. This follows the same approach used
// in AccountMenu.test.jsx.
// ---------------------------------------------------------------------------
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
  DropdownMenuLabel: ({ children }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuCheckboxItem: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
}));

// ---------------------------------------------------------------------------
// Mock autoFillEngine so we can control what handleAutoFill produces
// ---------------------------------------------------------------------------
const autoFillMocks = vi.hoisted(() => ({
  generateSuggestions: vi.fn(),
}));

vi.mock('@/components/schedule/autoFillEngine', () => ({
  generateSuggestions: autoFillMocks.generateSuggestions,
}));

// Import ScheduleBoard AFTER the mocks are set up
import ScheduleBoard from '@/components/schedule/ScheduleBoard';

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: 'user-admin',
  email: 'admin@test.local',
  role: 'admin',
  must_change_password: false,
};

/** Catch-all handlers for unhandled API endpoints. */
const catchAllGet = createRouteHandler('get', '*/api/*', () =>
  Response.json([])
);
const catchAllPatch = createRouteHandler('patch', '*/api/*', () =>
  Response.json({ success: true })
);

function seedAdminToken() {
  localStorage.setItem('radioplan_jwt_token', 'stored-test-token');
}

// ---------------------------------------------------------------------------
// Seed data factories
// ---------------------------------------------------------------------------

const FOCUS_DATE = '2026-07-06'; // Monday

/** Minimal entity seed for a rendered ScheduleBoard with 4 shift chips. */
function createSeedEntities() {
  return {
    Doctor: [
      { id: 'doc-1', name: 'Dr. Anna Adler', initials: 'AA', active: true, role: 'Facharzt', fte: 1.0 },
      { id: 'doc-2', name: 'Dr. Ben Braun', initials: 'BB', active: true, role: 'Facharzt', fte: 1.0 },
      { id: 'doc-3', name: 'Dr. Clara Chen', initials: 'CC', active: true, role: 'Assistenzarzt', fte: 0.5 },
    ],
    Workplace: [
      { id: 'wp-na', name: 'Notaufnahme', category: 'Dienste', order: 1, canWrite: true, active_days: [1, 2, 3, 4, 5] },
      { id: 'wp-ct', name: 'CT', category: 'Dienste', order: 2, canWrite: true, active_days: [1, 2, 3, 4, 5] },
      { id: 'wp-mrt', name: 'MRT', category: 'Dienste', order: 3, canWrite: true, active_days: [1, 2, 3, 4, 5] },
      { id: 'wp-sonne', name: 'Sonnensaal', category: 'Dienste', order: 4, canWrite: true, active_days: [1, 2, 3, 4, 5] },
    ],
    ShiftEntry: [
      { id: 'shift-fg', date: FOCUS_DATE, position: 'Notaufnahme', doctor_id: 'doc-1', start_time: '07:00', end_time: '15:00' },
      { id: 'shift-ct', date: '2026-07-07', position: 'CT', doctor_id: 'doc-2', start_time: '08:00', end_time: '16:00' },
      { id: 'shift-mrt', date: '2026-07-08', position: 'MRT', doctor_id: 'doc-1', start_time: '08:00', end_time: '14:00' },
      { id: 'shift-sonne', date: '2026-07-09', position: 'Sonnensaal', doctor_id: 'doc-3', start_time: '07:00', end_time: '15:00' },
    ],
    WorkplaceTimeslot: [],
    SystemSetting: [],
    StaffingPlanEntry: [],
    WishRequest: [],
    TrainingRotation: [],
    ColorSetting: [
      { id: 'cs-1', name: 'Facharzt', background_color: '#dbeafe', text_color: '#1e40af' },
      { id: 'cs-2', name: 'Assistenzarzt', background_color: '#dcfce7', text_color: '#166534' },
    ],
    ScheduleNote: [],
    ScheduleBlock: [],
    Qualification: [],
    DoctorQualification: [],
    WorkplaceQualification: [],
    TeamRole: [
      { id: 'tr-1', name: 'Facharzt', priority: 1 },
      { id: 'tr-2', name: 'Assistenzarzt', priority: 2 },
    ],
    Holiday: [],
  };
}

/**
 * Render ScheduleBoard with standard seed data and MSW handlers.
 * Returns the renderWithProviders result.
 */
function renderBoard(overrides = {}) {
  const entities = overrides.entities ?? createSeedEntities();

  server.use(
    ...createDbHandlers({ entities }),
    ...createAuthHandlers({ user: ADMIN_USER }),
    createRouteHandler('get', '*/api/auth/my-groups', () =>
      Response.json({ groups: [] })
    ),
    createRouteHandler('post', '*/api/auth/presence', () =>
      Response.json({ success: true })
    ),
    catchAllGet,
    catchAllPatch
  );

  return renderWithProviders(<ScheduleBoard />, {
    route: `/schedule?view=week&date=${FOCUS_DATE}`,
    withAuthProvider: true,
    withToaster: true,
  });
}

/**
 * Seed with a qualification mismatch so DraggableShift renders a warning icon.
 *
 * Workplace "CT" requires qualification "Radiologie" (is_mandatory=true).
 * doc-1 (Anna Adler) does NOT hold "Radiologie" → should show unqualified warning.
 */
function createSeedWithQualificationWarning() {
  return {
    Doctor: [
      { id: 'doc-1', name: 'Dr. Anna Adler', initials: 'AA', active: true, role: 'Facharzt', fte: 1.0 },
    ],
    Workplace: [
      { id: 'wp-na', name: 'Notaufnahme', category: 'Dienste', order: 1, canWrite: true, active_days: [1, 2, 3, 4, 5] },
      { id: 'wp-ct', name: 'CT', category: 'Dienste', order: 2, canWrite: true, active_days: [1, 2, 3, 4, 5] },
    ],
    ShiftEntry: [
      { id: 'shift-ct', date: FOCUS_DATE, position: 'CT', doctor_id: 'doc-1', start_time: '08:00', end_time: '16:00' },
    ],
    WorkplaceTimeslot: [],
    SystemSetting: [],
    StaffingPlanEntry: [],
    WishRequest: [],
    TrainingRotation: [],
    ColorSetting: [
      { id: 'cs-1', name: 'Facharzt', background_color: '#dbeafe', text_color: '#1e40af' },
    ],
    ScheduleNote: [],
    ScheduleBlock: [],
    Qualification: [
      { id: 'qual-rad', name: 'Radiologie', short_label: 'RAD', is_active: true },
    ],
    DoctorQualification: [],
    WorkplaceQualification: [
      { id: 'wq-1', workplace_id: 'wp-ct', qualification_id: 'qual-rad', is_mandatory: true, is_excluded: false },
    ],
    TeamRole: [
      { id: 'tr-1', name: 'Facharzt', priority: 1 },
    ],
    Holiday: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScheduleBoard rendering (Pre-PR 3.0B)', () => {
  beforeEach(() => {
    seedAdminToken();
    autoFillMocks.generateSuggestions.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- 1. Seeded data rendering: shift chips visible ----

  it('renders shift chips matching seeded shift data', async () => {
    renderBoard();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    // Verify all 4 seeded shifts appear as chips
    expect(await screen.findByTestId('schedule-shift-shift-fg')).toBeInTheDocument();
    expect(await screen.findByTestId('schedule-shift-shift-ct')).toBeInTheDocument();
    expect(await screen.findByTestId('schedule-shift-shift-mrt')).toBeInTheDocument();
    expect(await screen.findByTestId('schedule-shift-shift-sonne')).toBeInTheDocument();
  });

  // ---- 2. Qualification warning icon ----

  it('shows qualification warning icon on unqualified shift', async () => {
    renderBoard({ entities: createSeedWithQualificationWarning() });

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    // The CT shift should have a qualification warning because doc-1 lacks "Radiologie"
    expect(await screen.findByTestId('schedule-shift-qualification-warning-shift-ct')).toBeInTheDocument();
  });

  // ---- 3. Section headers visible ----

  it('displays section headers', async () => {
    renderBoard();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    // Core static sections are always rendered in the grid.
    // "Rotationen" only appears if rotation workplaces exist — not seeded here.
    await waitFor(() => {
      const documentText = document.body.textContent;
      expect(documentText).toContain('Dienste');
      expect(documentText).toContain('Abwesenheiten');
      expect(documentText).toContain('Anwesenheiten');
    });
  });

  // ---- 4. Switch to month view ----

  it('switches to month view and shows month label', async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    await user.click(screen.getByTestId('schedule-view-month'));

    expect(screen.getByTestId('schedule-view-month')).toHaveAttribute('data-state', 'active');

    const periodLabel = screen.getByTestId('schedule-current-period');
    expect(periodLabel.textContent).toMatch(/Juli\s+2026/);
  });

  // ---- 5. Switch to day view ----

  it('switches to day view and shows day label', async () => {
    const user = userEvent.setup();
    renderBoard();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    await user.click(screen.getByTestId('schedule-view-day'));

    expect(screen.getByTestId('schedule-view-day')).toHaveAttribute('data-state', 'active');

    const periodLabel = screen.getByTestId('schedule-current-period');
    expect(periodLabel.textContent).toMatch(/6\.\s*(Juli|07)\s*2026/);
  });

  // ---- 6. Auto-fill trigger and preview bar ----

  it('shows preview bar with suggestion count after auto-fill', async () => {
    // Return 3 mock suggestions from the auto-fill engine
    autoFillMocks.generateSuggestions.mockReturnValue([
      { id: 'preview-1', date: FOCUS_DATE, position: 'Notaufnahme', doctor_id: 'doc-1', isPreview: true },
      { id: 'preview-2', date: '2026-07-07', position: 'CT', doctor_id: 'doc-2', isPreview: true },
      { id: 'preview-3', date: '2026-07-08', position: 'MRT', doctor_id: 'doc-3', isPreview: true },
    ]);

    renderBoard();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    // The dropdown menu is mocked to render inline, so content is always visible.
    // Click "Alle Kategorien" to trigger auto-fill.
    fireEvent.click(screen.getByTestId('schedule-auto-fill-all'));

    // The preview bar should appear with the suggestion count
    const previewBar = await screen.findByTestId('schedule-preview-bar');
    expect(previewBar).toBeInTheDocument();

    // Verify the bar contains "Vorschläge" text and action buttons
    expect(previewBar.textContent).toMatch(/Vorschläge/);
    expect(screen.getByTestId('schedule-preview-apply')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-preview-discard')).toBeInTheDocument();
  });

  // ---- 7. Undo button ----

  it('renders undo button as disabled when undo stack is empty', async () => {
    renderBoard();

    expect(await screen.findByTestId('schedule-toolbar')).toBeInTheDocument();

    const undoButton = screen.getByTestId('schedule-undo');
    expect(undoButton).toBeInTheDocument();
    expect(undoButton).toBeDisabled();
  });
});
