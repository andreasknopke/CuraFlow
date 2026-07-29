// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserPermissionsDialog from '../UserPermissionsDialog';

// Mock the API client — only updateUser is exercised by the dialog.
vi.mock('@/api/client', () => ({
  api: {
    updateUser: vi.fn().mockResolvedValue({}),
  },
}));

// Mock sonner toast (not used directly by the dialog, but imported via api).
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/**
 * A granter restricted to can_manage_users only. They LACK can_manage_system,
 * so that checkbox must be disabled and unchecked (F3) — and the backend
 * clamp (permissionClamp.test.js) guarantees it can never be stored true.
 */
const restrictedGranter = {
  id: 'granter-1',
  email: 'granter@x.de',
  role: 'admin',
  permissions: { can_manage_users: true, can_manage_system: false },
  is_super_admin: false,
};

const targetUser = {
  id: 'target-1',
  email: 'target@x.de',
  role: 'admin',
  permissions: {},
  is_super_admin: false,
};

describe('UserPermissionsDialog — granter cannot grant what they lack (F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables the checkbox for a permission the granter lacks', () => {
    renderWithProviders(
      <UserPermissionsDialog
        open
        onOpenChange={() => {}}
        user={targetUser}
        currentUser={restrictedGranter}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /System-Einstellungen/i }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('leaves the checkbox enabled for a permission the granter holds', () => {
    renderWithProviders(
      <UserPermissionsDialog
        open
        onOpenChange={() => {}}
        user={targetUser}
        currentUser={restrictedGranter}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /Benutzer verwalten/i }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it('renders the granter-lacking checkbox unchecked by default', () => {
    renderWithProviders(
      <UserPermissionsDialog
        open
        onOpenChange={() => {}}
        user={targetUser}
        currentUser={restrictedGranter}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /System-Einstellungen/i });
    // targetUser.permissions is {} → would default to checked, but the granter
    // lacks it → must be force-unchecked (matches the backend clamp). Radix
    // Checkbox reflects state via data-state, not the native checked property.
    expect(checkbox.getAttribute('data-state')).toBe('unchecked');
  });
});
