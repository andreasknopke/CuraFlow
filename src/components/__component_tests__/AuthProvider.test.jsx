import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from '@/components/AuthProvider';
import { renderWithProviders } from '@/test-utils/renderWithProviders';
import { createAuthHandlers, createRouteHandler, server } from '@/test-utils/server';

vi.mock('@/components/dbTokenStorage', () => ({
  clearActiveDbToken: vi.fn(() => Promise.resolve()),
}));

function AuthProbe() {
  const {
    allowedTenants,
    completeTenantSelection,
    hasFullTenantAccess,
    isAuthenticated,
    isLoading,
    isReadOnly,
    login,
    needsTenantSelection,
    user,
  } = useAuth();

  if (isLoading) {
    return <div>loading</div>;
  }

  return (
    <div>
      <div>auth-state:{isAuthenticated ? 'authenticated' : 'anonymous'}</div>
      <div>user-email:{user?.email ?? 'no-email'}</div>
      <div>user-role:{user?.role ?? 'no-role'}</div>
      <div>access-mode:{isReadOnly ? 'read-only' : 'full-access'}</div>
      <div>tenant-state:{needsTenantSelection ? 'needs-tenant-selection' : 'tenant-selected'}</div>
      <div>tenant-access:{hasFullTenantAccess ? 'all-tenants' : 'restricted-tenants'}</div>
      <div>tenant-count:{allowedTenants.length}</div>
      <button type="button" onClick={() => login('user@test.local', 'user-secret')}>
        login user
      </button>
      <button type="button" onClick={completeTenantSelection}>
        complete tenant selection
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('hydrates the authenticated user when a stored token is still valid', async () => {
    localStorage.setItem('radioplan_jwt_token', 'stored-test-token');

    server.use(
      ...createAuthHandlers({
        user: {
          id: 'user-admin',
          email: 'admin@test.local',
          role: 'admin',
          must_change_password: false,
        },
      })
    );

    renderWithProviders(<AuthProbe />);

    expect(await screen.findByText('auth-state:authenticated')).toBeInTheDocument();
    expect(screen.getByText('user-email:admin@test.local')).toBeInTheDocument();
    expect(screen.getByText('user-role:admin')).toBeInTheDocument();
    expect(screen.getByText('access-mode:full-access')).toBeInTheDocument();
  });

  it('clears an invalid stored token and falls back to an anonymous state', async () => {
    localStorage.setItem('radioplan_jwt_token', 'expired-test-token');
    server.use(...createAuthHandlers());

    renderWithProviders(<AuthProbe />);

    expect(await screen.findByText('auth-state:anonymous')).toBeInTheDocument();
    expect(screen.getByText('user-email:no-email')).toBeInTheDocument();
    expect(localStorage.getItem('radioplan_jwt_token')).toBeNull();
  });

  it('marks a non-admin user as read-only and requests tenant selection after login', async () => {
    const user = userEvent.setup();

    server.use(
      ...createAuthHandlers({
        user: {
          id: 'user-standard',
          email: 'user@test.local',
          role: 'user',
          must_change_password: false,
        },
        tenants: [
          {
            id: 'tenant-main',
            name: 'CuraFlow Test Tenant',
            is_active: true,
          },
        ],
      })
    );

    renderWithProviders(<AuthProbe />);

    await user.click(await screen.findByRole('button', { name: 'login user' }));

    expect(await screen.findByText('auth-state:authenticated')).toBeInTheDocument();
    expect(screen.getByText('user-email:user@test.local')).toBeInTheDocument();
    expect(screen.getByText('user-role:user')).toBeInTheDocument();
    expect(screen.getByText('access-mode:read-only')).toBeInTheDocument();
    expect(screen.getByText('tenant-state:needs-tenant-selection')).toBeInTheDocument();
    expect(screen.getByText('tenant-access:restricted-tenants')).toBeInTheDocument();
    expect(screen.getByText('tenant-count:1')).toBeInTheDocument();
    expect(localStorage.getItem('radioplan_jwt_token')).toBe('test-jwt-token');

    await user.click(screen.getByRole('button', { name: 'complete tenant selection' }));
    expect(screen.getByText('tenant-state:tenant-selected')).toBeInTheDocument();
  });

  it('keeps the user authenticated when tenant loading fails during login', async () => {
    const user = userEvent.setup();

    server.use(
      createRouteHandler('GET', '*/api/auth/my-tenants', () => new Response(null, { status: 500 })),
      ...createAuthHandlers({
        user: {
          id: 'user-standard',
          email: 'user@test.local',
          role: 'user',
          must_change_password: false,
        },
      })
    );

    renderWithProviders(<AuthProbe />);

    await user.click(await screen.findByRole('button', { name: 'login user' }));

    expect(await screen.findByText('auth-state:authenticated')).toBeInTheDocument();
    expect(screen.getByText('tenant-state:tenant-selected')).toBeInTheDocument();
    expect(screen.getByText('tenant-count:0')).toBeInTheDocument();
  });
});
