import { describe, expect, it, vi } from 'vitest';

import { syncTenantDoctorCentralLink } from '@/components/staff/centralLinkSync';

describe('syncTenantDoctorCentralLink', () => {
  it('does nothing when the central link did not change', async () => {
    const apiClient = { request: vi.fn() };

    await syncTenantDoctorCentralLink({
      doctorId: 'doctor-1',
      tenantId: 'tenant-1',
      previousCentralEmployeeId: 'employee-1',
      nextCentralEmployeeId: 'employee-1',
      apiClient,
    });

    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it('links a tenant doctor to the selected central employee', async () => {
    const apiClient = { request: vi.fn().mockResolvedValue({ success: true }) };

    await syncTenantDoctorCentralLink({
      doctorId: 'doctor-1',
      tenantId: 'tenant-1',
      previousCentralEmployeeId: null,
      nextCentralEmployeeId: 'employee-2',
      apiClient,
    });

    expect(apiClient.request).toHaveBeenCalledWith('/api/staff/central-link', {
      method: 'POST',
      body: JSON.stringify({ employee_id: 'employee-2', doctor_id: 'doctor-1' }),
    });
  });

  it('unlinks a tenant doctor when the central reference is cleared', async () => {
    const apiClient = { request: vi.fn().mockResolvedValue({ success: true }) };

    await syncTenantDoctorCentralLink({
      doctorId: 'doctor-1',
      tenantId: 'tenant-1',
      previousCentralEmployeeId: 'employee-2',
      nextCentralEmployeeId: null,
      apiClient,
    });

    expect(apiClient.request).toHaveBeenCalledWith('/api/staff/central-unlink', {
      method: 'POST',
      body: JSON.stringify({ doctor_id: 'doctor-1' }),
    });
  });
});