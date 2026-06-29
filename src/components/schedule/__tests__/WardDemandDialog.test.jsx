// @vitest-environment happy-dom
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WardDemandDialog from '../WardDemandDialog';

vi.mock('@/api/client', () => ({
  api: {
    createWardDemand: vi.fn().mockResolvedValue({}),
    updateWardDemand: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('sonner', () => ({
  toast: { info: vi.fn() },
}));

function renderDialog(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workplace: { id: 'wp-1', name: 'Gyn 1' },
    dateStr: '2026-07-15',
    timeslot: null,
    existingDemand: null,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <WardDemandDialog {...defaultProps} {...props} />
    </QueryClientProvider>
  );
}

// Radix Dialog renders its content via portal into document.body.
// The React container only contains the trigger; the actual dialog
// content appears in document.body. We therefore query document.body.

describe('WardDemandDialog', () => {
  it('renders dialog title and workplace name in create mode', () => {
    renderDialog();
    const html = document.body.innerHTML;
    expect(html).toContain('Springer-Bedarf anmelden');
    expect(html).toContain('Gyn 1');
  });

  it('shows a textarea for optional note', () => {
    renderDialog();
    const textareas = document.body.querySelectorAll('textarea');
    expect(textareas.length).toBeGreaterThanOrEqual(1);
    const hasCorrectPlaceholder = Array.from(textareas).some(
      (t) => t.getAttribute('placeholder')?.toLowerCase().includes('fachkraft')
    );
    expect(hasCorrectPlaceholder).toBe(true);
  });

  it('renders cancel mode with demand note', () => {
    renderDialog({
      existingDemand: { id: 'd1', status: 'open', note: 'Bitte Fachkraft' },
    });
    const html = document.body.innerHTML;
    expect(html).toContain('Bedarf stornieren');
    expect(html).toContain('Bitte Fachkraft');
  });

  it('renders fulfilled mode with employee name', () => {
    renderDialog({
      existingDemand: {
        id: 'd2', status: 'fulfilled', note: 'Erledigt',
        fulfilled_employee_name: 'Max Mustermann',
      },
    });
    const html = document.body.innerHTML;
    expect(html).toContain('Bedarf – bereits erfüllt');
    expect(html).toContain('Max Mustermann');
    expect(html).toContain('Erledigt');
  });

  it('shows timeslot label in description', () => {
    renderDialog({ timeslot: { id: 'ts-1', label: 'Frühdienst' } });
    expect(document.body.innerHTML).toContain('Frühdienst');
  });
});
