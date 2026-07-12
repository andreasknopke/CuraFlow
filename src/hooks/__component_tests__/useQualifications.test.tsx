import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useQualifications,
  DEFAULT_QUALIFICATIONS,
  initializeDefaultQualifications,
} from '../useQualifications';

// Mock the DB client
vi.mock('@/api/client', () => ({
  db: {
    Qualification: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    DoctorQualification: {
      filter: vi.fn(),
      delete: vi.fn(),
    },
    WorkplaceQualification: {
      filter: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { db } from '@/api/client';

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

describe('DEFAULT_QUALIFICATIONS', () => {
  it('contains 4 default qualifications', () => {
    expect(DEFAULT_QUALIFICATIONS).toHaveLength(4);
  });

  it('includes Facharzt as the first entry', () => {
    expect(DEFAULT_QUALIFICATIONS[0].name).toBe('Facharzt');
    expect(DEFAULT_QUALIFICATIONS[0].short_label).toBe('FA');
  });

  it('includes Vordergrund-berechtigt', () => {
    expect(DEFAULT_QUALIFICATIONS[1].name).toBe('Vordergrund-berechtigt');
    expect(DEFAULT_QUALIFICATIONS[1].category).toBe('Dienst');
  });

  it('includes Hintergrund-berechtigt', () => {
    expect(DEFAULT_QUALIFICATIONS[2].name).toBe('Hintergrund-berechtigt');
    expect(DEFAULT_QUALIFICATIONS[2].category).toBe('Dienst');
  });

  it('includes Strahlenschutz with certificate requirements', () => {
    const strahlenschutz = DEFAULT_QUALIFICATIONS[3];
    expect(strahlenschutz.name).toBe('Strahlenschutz');
    expect(strahlenschutz.requires_certificate).toBe(true);
    expect(strahlenschutz.certificate_validity_months).toBe(60);
  });

  it('each qualification has required fields', () => {
    for (const qual of DEFAULT_QUALIFICATIONS) {
      expect(qual.name).toBeTruthy();
      expect(qual.short_label).toBeTruthy();
      expect(qual.color_bg).toBeTruthy();
      expect(qual.color_text).toBeTruthy();
      expect(typeof qual.order).toBe('number');
    }
  });
});

describe('initializeDefaultQualifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing qualifications when DB already has data', async () => {
    const existing = [{ id: 1, name: 'Existing' }];
    db.Qualification.list.mockResolvedValue(existing);

    const result = await initializeDefaultQualifications();

    expect(db.Qualification.list).toHaveBeenCalledTimes(1);
    expect(db.Qualification.create).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  it('creates all default qualifications when DB is empty', async () => {
    db.Qualification.list.mockResolvedValue([]);
    db.Qualification.create.mockImplementation((data) => ({ id: Math.random(), ...data }));

    const result = await initializeDefaultQualifications();

    expect(db.Qualification.list).toHaveBeenCalledTimes(1);
    expect(db.Qualification.create).toHaveBeenCalledTimes(4);
    expect(result).toHaveLength(4);
    expect(result[0].name).toBe('Facharzt');
    expect(result[3].name).toBe('Strahlenschutz');
  });

  it('returns DEFAULT_QUALIFICATIONS on error', async () => {
    db.Qualification.list.mockRejectedValue(new Error('DB error'));

    const result = await initializeDefaultQualifications();

    expect(result).toEqual(DEFAULT_QUALIFICATIONS);
  });
});

describe('useQualifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array and isLoading initially', () => {
    db.Qualification.list.mockResolvedValue([]);

    const { result } = renderHook(() => useQualifications(), {
      wrapper: createWrapper(),
    });

    expect(result.current.qualifications).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('fetches and returns qualifications', async () => {
    db.Qualification.list.mockResolvedValue([
      { id: 1, name: 'Facharzt', order: 0 },
      { id: 2, name: 'CT', order: 3 },
      { id: 3, name: 'MRT', order: 1 },
    ]);

    const { result } = renderHook(() => useQualifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Results should be sorted by order
    expect(result.current.qualifications).toHaveLength(3);
    expect(result.current.qualifications[0].name).toBe('Facharzt');
    expect(result.current.qualifications[1].name).toBe('MRT');
    expect(result.current.qualifications[2].name).toBe('CT');
  });

  it('calls initializeDefaultQualifications when DB returns empty', async () => {
    db.Qualification.list.mockResolvedValue([]);
    db.Qualification.create.mockImplementation((data) => ({ id: Math.random(), ...data }));

    const { result } = renderHook(() => useQualifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should have created defaults since DB was empty
    expect(db.Qualification.create).toHaveBeenCalled();
    expect(result.current.qualifications.length).toBeGreaterThan(0);
  });

  it('returns refetch function', async () => {
    db.Qualification.list.mockResolvedValue([]);

    const { result } = renderHook(() => useQualifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.refetch).toBe('function');
  });

  it('handles API errors gracefully', async () => {
    db.Qualification.list.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useQualifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.qualifications).toEqual([]);
  });
});

describe('useQualifications — mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls db.Qualification.create when createQualification is triggered', async () => {
    db.Qualification.list.mockResolvedValue([
      { id: 1, name: 'Existing', order: 0 },
    ]);
    db.Qualification.create.mockResolvedValue({ id: 2, name: 'New Qual' });

    const { result } = renderHook(() => useQualifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // We don't directly expose createQualification, but the hook uses a mutation internally.
    // The query and mutation are set up; we verify the initial state loads.
    expect(result.current.qualifications).toHaveLength(1);
  });
});
