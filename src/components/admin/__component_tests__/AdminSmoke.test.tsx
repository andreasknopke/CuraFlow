import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import UserManagement from '@/components/admin/UserManagement';
import ServerTokenManager from '@/components/admin/ServerTokenManager';
import DatabaseManagement from '@/components/admin/DatabaseManagement';
import AdminSettings from '@/components/admin/AdminSettings';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

// --- Shared mocks ---

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  register: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  sendPasswordEmail: vi.fn(),
  apiRequest: vi.fn(),
  listGroups: vi.fn(),
  systemSettingList: vi.fn(),
  systemSettingUpdate: vi.fn(),
  systemSettingCreate: vi.fn(),
  workplaceList: vi.fn(),
  useAuth: vi.fn(),
  getActiveDbToken: vi.fn(),
  saveDbToken: vi.fn(),
  enableDbToken: vi.fn(),
  disableDbToken: vi.fn(),
  isDbTokenEnabled: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    listUsers: mocks.listUsers,
    register: mocks.register,
    updateUser: mocks.updateUser,
    deleteUser: mocks.deleteUser,
    sendPasswordEmail: mocks.sendPasswordEmail,
    request: mocks.apiRequest,
    listGroups: mocks.listGroups,
  },
  db: {
    SystemSetting: {
      list: mocks.systemSettingList,
      update: mocks.systemSettingUpdate,
      create: mocks.systemSettingCreate,
    },
    Workplace: {
      list: mocks.workplaceList,
    },
  },
}));

vi.mock('@/components/AuthProvider', () => ({
  AuthProvider: ({ children }: any) => <>{children}</>,
  useAuth: mocks.useAuth,
}));

vi.mock('@/components/dbTokenStorage', () => ({
  getActiveDbToken: mocks.getActiveDbToken,
  saveDbToken: mocks.saveDbToken,
  enableDbToken: mocks.enableDbToken,
  disableDbToken: mocks.disableDbToken,
  isDbTokenEnabled: mocks.isDbTokenEnabled,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

// Note: ServerTokenManager is NOT mocked here — test 9 renders the real component.
// For DatabaseManagement (test 10), the real ServerTokenManager is used since it
// queries via the mocked api.request.

vi.mock('@/components/staff/EmployeeSelect', () => ({
  default: () => <div data-testid="employee-select" />,
}));

vi.mock('@/components/admin/UserPermissionsDialog', () => ({
  default: () => <div data-testid="user-permissions-dialog" />,
}));

// --- Tests ---

describe('Admin smoke tests', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock: any) => mock.mockReset());

    // Default: mock a simple admin user
    (mocks.useAuth as any).mockReturnValue({
      user: { id: 1, email: 'admin@test.de', full_name: 'Admin User', role: 'admin' },
      token: 'test-jwt-token',
    });

    (mocks.listUsers as any).mockResolvedValue([
      { id: 1, email: 'admin@test.de', full_name: 'Admin User', role: 'admin', is_active: 1, email_verified: 1, allowed_tenants: null, allowed_groups: null, group_admin_groups: null },
      { id: 2, email: 'user@test.de', full_name: 'Test User', role: 'user', is_active: 1, email_verified: 0, allowed_tenants: null, allowed_groups: null, group_admin_groups: null },
    ]);

    (mocks.apiRequest as any).mockImplementation((url: string, options?: any) => {
      // ServerTokenManager queries
      if (url === '/api/admin/db-tokens') return Promise.resolve([]);
      if (url === '/api/admin/migration-status') return Promise.resolve({ migrations: [], allApplied: true });
      return Promise.resolve([]);
    });

    (mocks.listGroups as any).mockResolvedValue({ groups: [] });
    (mocks.systemSettingList as any).mockResolvedValue([
      { id: 1, key: 'wish_deadline_months', value: '2' },
      { id: 2, key: 'wish_approval_rules', value: JSON.stringify({ service_requires_approval: true, no_service_requires_approval: false, position_overrides: {}, auto_create_shift_on_approval: false }) },
    ]);
    (mocks.workplaceList as any).mockResolvedValue([]);
    (mocks.systemSettingUpdate as any).mockResolvedValue({});
    (mocks.systemSettingCreate as any).mockResolvedValue({});
    (mocks.getActiveDbToken as any).mockReturnValue(null);
    (mocks.isDbTokenEnabled as any).mockReturnValue(false);

    window.confirm = vi.fn(() => true);
  });

  it('UserManagement — renders with user list visible', async () => {
    renderWithProviders(<UserManagement />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByTestId('admin-user-management')).toBeInTheDocument();
    expect(screen.getByText('Benutzerverwaltung')).toBeInTheDocument();
    expect(screen.getByText('admin@test.de')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-create-button')).toBeInTheDocument();
  });

  it('UserManagement — create user dialog opens with form fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserManagement />, {
      withAuthProvider: false,
      withToaster: false,
    });

    await user.click(await screen.findByTestId('admin-user-create-button'));

    expect(screen.getByTestId('admin-user-create-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-create-email')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-create-name')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-create-password')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-create-role')).toBeInTheDocument();
  });

  it('ServerTokenManager — renders with empty state', async () => {
    renderWithProviders(<ServerTokenManager />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByText('Mandanten-Datenbanken')).toBeInTheDocument();
    expect(await screen.findByText('Keine Mandanten-Verbindungen konfiguriert', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('Datenbank-Schema ist aktuell', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('DatabaseManagement — renders with tool cards and buttons', async () => {
    renderWithProviders(<DatabaseManagement />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByText('MySQL-Modus aktiv')).toBeInTheDocument();
    expect(screen.getByText('Datenbank-Tools')).toBeInTheDocument();
    // "Datenbank leeren" appears twice: button text + wipe dialog title (dialog mock renders inline)
    expect(screen.getAllByText('Datenbank leeren').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Integritätsprüfung')).toBeInTheDocument();
    expect(screen.getByText('Prüfung starten')).toBeInTheDocument();
  });

  it('AdminSettings — renders with settings fields present', async () => {
    renderWithProviders(<AdminSettings />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByTestId('admin-settings-panel')).toBeInTheDocument();
    expect(screen.getByText('System-Einstellungen')).toBeInTheDocument();
    expect(screen.getByTestId('admin-settings-wish-deadline-months')).toBeInTheDocument();
    expect(screen.getByText('Genehmigungspflicht für Wünsche')).toBeInTheDocument();
    expect(screen.getByTestId('admin-settings-service-requires-approval')).toBeInTheDocument();
    expect(screen.getByTestId('admin-settings-no-service-requires-approval')).toBeInTheDocument();
    expect(screen.getByTestId('admin-settings-auto-create-shift-on-approval')).toBeInTheDocument();
  });
});
