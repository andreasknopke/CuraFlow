import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OverrideConfirmDialog from '@/components/validation/OverrideConfirmDialog';

describe('OverrideConfirmDialog', () => {
  it('shows no "Nicht verfügbar" removal option when the conflict is unrelated', async () => {
    const onConfirm = vi.fn();
    render(
      <OverrideConfirmDialog
        open
        onOpenChange={() => {}}
        blockers={['Mitarbeiter ist bereits als "Frei" eingetragen (blockiert).']}
        context={{ doctorName: 'Dr. Test', date: '05.08.2026', position: 'Bereitschaftsdienst' }}
        onConfirm={onConfirm}
      />
    );

    expect(await screen.findByText('Konflikt erkannt')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fortfahren' }));
    expect(screen.queryByRole('checkbox', { name: 'Mitarbeiter aus „Nicht verfügbar" entfernen' })).toBeNull();
  });

  it('offers removing the "Nicht verfügbar" entry (pre-checked) and forwards the decision on confirm', async () => {
    const onConfirm = vi.fn();
    render(
      <OverrideConfirmDialog
        open
        onOpenChange={() => {}}
        blockers={['Mitarbeiter ist bereits als "Nicht verfügbar" eingetragen (blockiert).']}
        context={{ doctorName: 'Dr. Test', date: '05.08.2026', position: 'Bereitschaftsdienst', unavailableConflict: true }}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Fortfahren' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Mitarbeiter aus „Nicht verfügbar" entfernen' });
    // Default: vorausgewählt, damit der Eintrag beim Override entfernt wird
    expect(checkbox.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('Keine Begründung angegeben', true);
    });
  });

  it('forwards removeUnavailable=false when the user unchecks the option', async () => {
    const onConfirm = vi.fn();
    render(
      <OverrideConfirmDialog
        open
        onOpenChange={() => {}}
        blockers={['Mitarbeiter ist bereits als "Nicht verfügbar" eingetragen (blockiert).']}
        context={{ doctorName: 'Dr. Test', date: '05.08.2026', position: 'Bereitschaftsdienst', unavailableConflict: true }}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Fortfahren' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Mitarbeiter aus „Nicht verfügbar" entfernen' });
    fireEvent.click(checkbox);
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('Keine Begründung angegeben', false);
    });
  });
});
