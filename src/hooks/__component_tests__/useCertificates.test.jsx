import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCertificates, useExpiringCertificates, openCertificateInNewTab } from '../useCertificates';

// Mock the API client
vi.mock('@/api/client', () => ({
  api: {
    listCertificates: vi.fn(),
    listExpiringCertificates: vi.fn(),
    uploadCertificate: vi.fn(),
    checkCertificate: vi.fn(),
    updateCertificate: vi.fn(),
    deleteCertificate: vi.fn(),
    reanalyzeCertificate: vi.fn(),
    fetchCertificateBlob: vi.fn(),
  },
}));

import { api } from '@/api/client';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useCertificates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array and not loading before data arrives', () => {
    api.listCertificates.mockResolvedValue([]);

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    expect(result.current.certificates).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('fetches certificates without filters', async () => {
    api.listCertificates.mockResolvedValue([{ id: 1, name: 'Test-Zertifikat' }]);

    const { result } = renderHook(() => useCertificates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.listCertificates).toHaveBeenCalledWith({
      doctor_id: undefined,
      qualification_id: undefined,
    });
    expect(result.current.certificates).toEqual([{ id: 1, name: 'Test-Zertifikat' }]);
  });

  it('passes doctor_id filter to the API', async () => {
    api.listCertificates.mockResolvedValue([]);

    const { result } = renderHook(() => useCertificates({ doctorId: 42 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.listCertificates).toHaveBeenCalledWith({
      doctor_id: 42,
      qualification_id: undefined,
    });
  });

  it('passes qualification_id filter to the API', async () => {
    api.listCertificates.mockResolvedValue([]);

    const { result } = renderHook(() => useCertificates({ qualificationId: 7 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.listCertificates).toHaveBeenCalledWith({
      doctor_id: undefined,
      qualification_id: 7,
    });
  });

  it('does not fetch when disabled', () => {
    api.listCertificates.mockResolvedValue([]);

    renderHook(() => useCertificates({ doctorId: 1, enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(api.listCertificates).not.toHaveBeenCalled();
  });

  it('sets refetchInterval to 3000ms when a certificate has pending analysis', async () => {
    api.listCertificates.mockResolvedValue([
      { id: 1, name: 'Pending Cert', analysis_status: 'pending' },
    ]);

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.certificates).toHaveLength(1);
    expect(result.current.certificates[0].analysis_status).toBe('pending');
  });

  it('does not set refetchInterval when all certificates are processed', async () => {
    api.listCertificates.mockResolvedValue([
      { id: 1, name: 'Completed Cert', analysis_status: 'completed' },
    ]);

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.certificates).toHaveLength(1);
    expect(result.current.certificates[0].analysis_status).toBe('completed');
  });

  it('handles API errors gracefully', async () => {
    api.listCertificates.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.certificates).toEqual([]);
  });

  it('provides uploadCertificate mutation', async () => {
    api.listCertificates.mockResolvedValue([]);
    api.uploadCertificate.mockResolvedValue({ id: 99 });

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.uploadCertificate({ file: 'test.pdf' });
    expect(api.uploadCertificate).toHaveBeenCalledWith({ file: 'test.pdf' });
  });

  it('provides deleteCertificate mutation', async () => {
    api.listCertificates.mockResolvedValue([]);
    api.deleteCertificate.mockResolvedValue({});

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.deleteCertificate(5);
    expect(api.deleteCertificate).toHaveBeenCalledWith(5);
  });

  it('provides checkCertificate mutation', async () => {
    api.listCertificates.mockResolvedValue([]);
    api.checkCertificate.mockResolvedValue({ valid: true });

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.checkCertificate({ id: 3 });
    expect(api.checkCertificate).toHaveBeenCalledWith({ id: 3 });
  });

  it('provides updateCertificate mutation', async () => {
    api.listCertificates.mockResolvedValue([]);
    api.updateCertificate.mockResolvedValue({ id: 2 });

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.updateCertificate({ id: 2, name: 'Updated' });
    // The mutation destructures `id` from the payload, passing only `rest` as the second arg
    expect(api.updateCertificate).toHaveBeenCalledWith(2, { name: 'Updated' });
  });

  it('provides reanalyzeCertificate mutation', async () => {
    api.listCertificates.mockResolvedValue([]);
    api.reanalyzeCertificate.mockResolvedValue({});

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.reanalyzeCertificate({ id: 4, qualification_name: 'CT', qualification_description: 'CT-Befund' });
    expect(api.reanalyzeCertificate).toHaveBeenCalledWith(4, { qualification_name: 'CT', qualification_description: 'CT-Befund' });
  });

  it('exposes pending states for all mutations', async () => {
    api.listCertificates.mockResolvedValue([]);

    const { result } = renderHook(() => useCertificates({ doctorId: 1 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isChecking).toBe(false);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.isDeleting).toBe(false);
    expect(result.current.isReanalyzing).toBe(false);
  });
});

describe('useExpiringCertificates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches expiring certificates with default days', async () => {
    api.listExpiringCertificates.mockResolvedValue([{ id: 1, name: 'Expiring' }]);

    const { result } = renderHook(() => useExpiringCertificates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.listExpiringCertificates).toHaveBeenCalledWith(60);
    expect(result.current.expiring).toEqual([{ id: 1, name: 'Expiring' }]);
  });

  it('fetches expiring certificates with custom days', async () => {
    api.listExpiringCertificates.mockResolvedValue([]);

    const { result } = renderHook(() => useExpiringCertificates({ days: 30 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.listExpiringCertificates).toHaveBeenCalledWith(30);
  });

  it('does not fetch when disabled', () => {
    api.listExpiringCertificates.mockResolvedValue([]);

    renderHook(() => useExpiringCertificates({ enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(api.listExpiringCertificates).not.toHaveBeenCalled();
  });
});

describe('openCertificateInNewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.open
    vi.stubGlobal('window', {
      ...window,
      open: vi.fn(() => ({})),
      URL: {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches the certificate blob and opens it in a new tab', async () => {
    api.fetchCertificateBlob.mockResolvedValue(new Blob(['test'], { type: 'application/pdf' }));

    await openCertificateInNewTab(42);

    expect(api.fetchCertificateBlob).toHaveBeenCalledWith(42);
    // The blob URL is environment-dependent; just verify it opened with any blob:// URL
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open.mock.calls[0][1]).toBe('_blank');
    expect(window.open.mock.calls[0][0]).toMatch(/^blob:/);
  });

  it('creates a download link when popup is blocked', async () => {
    api.fetchCertificateBlob.mockResolvedValue(new Blob(['test'], { type: 'application/pdf' }));
    window.open.mockReturnValue(null);

    const appendChild = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', {
      ...document,
      createElement: vi.fn(() => ({
        href: '',
        click: vi.fn(),
        remove,
      })),
      body: { appendChild },
    });

    await openCertificateInNewTab(42);

    expect(appendChild).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});
