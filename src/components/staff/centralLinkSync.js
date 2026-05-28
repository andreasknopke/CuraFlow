import { api } from '@/api/client';

export async function syncTenantDoctorCentralLink({
  doctorId,
  tenantId,
  previousCentralEmployeeId,
  nextCentralEmployeeId,
  apiClient = api,
}) {
  if (!doctorId || !tenantId) {
    return;
  }

  const previousId = previousCentralEmployeeId || null;
  const nextId = nextCentralEmployeeId || null;

  if (previousId === nextId) {
    return;
  }

  if (nextId) {
    await apiClient.request('/api/staff/central-link', {
      method: 'POST',
      body: JSON.stringify({
        employee_id: nextId,
        doctor_id: doctorId,
      }),
    });
    return;
  }

  if (previousId) {
    await apiClient.request('/api/staff/central-unlink', {
      method: 'POST',
      body: JSON.stringify({
        doctor_id: doctorId,
      }),
    });
  }
}