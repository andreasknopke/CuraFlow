import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorYearView from '../DoctorYearView';
import type { Doctor, ShiftEntry } from '@/types/models';

const mockColorSettingList = vi.fn();
const mockSendEmail = vi.fn();

vi.mock('@/api/client', () => ({
  api: {
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  },
  db: {
    ColorSetting: {
      list: (...args: unknown[]) => mockColorSettingList(...args),
    },
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

const doctor: Doctor = {
  id: 'doc-1',
  name: 'Dr. Alice Example',
  initials: 'AE',
  role: 'Oberärztin',
  email: 'alice@example.com',
  google_email: 'alice.calendar@example.com',
  color: 'bg-blue-100',
  fte: 1,
  exclude_from_staffing_plan: false,
  order: 1,
  is_active: true,
  created_date: '2026-01-01 00:00:00',
  updated_date: '2026-01-01 00:00:00',
};

const makeShift = (overrides: Partial<ShiftEntry> = {}): ShiftEntry => ({
  id: 's1',
  date: '2099-01-10',
  position: 'Urlaub',
  doctor_id: 'doc-1',
  is_free_text: false,
  order: 1,
  created_date: '2026-01-01 00:00:00',
  updated_date: '2026-01-01 00:00:00',
  ...overrides,
});

describe('DoctorYearView', () => {
  beforeEach(() => {
    mockColorSettingList.mockReset();
    mockColorSettingList.mockResolvedValue([]);
    mockSendEmail.mockReset();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('renders doctor information and the absence email CTA for future absences', async () => {
    render(
      <DoctorYearView doctor={doctor} year={2099} shifts={[makeShift()]} onToggle={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Dr. Alice Example')).not.toBeNull();
    expect(screen.getByText(/Jahresplanung 2099/)).not.toBeNull();
    expect(await screen.findByRole('button', { name: /Abwesenheiten senden/i })).not.toBeNull();
  });

  it('calls onToggle when a day is clicked', async () => {
    const onToggle = vi.fn();
    const { container } = render(
      <DoctorYearView doctor={doctor} year={2099} shifts={[]} onToggle={onToggle} />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockColorSettingList).toHaveBeenCalled());

    const dayButton = container.querySelector('button[title$="10.01.2099"]');
    expect(dayButton).not.toBeNull();

    fireEvent.click(dayButton as HTMLButtonElement);

    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(onToggle.mock.calls[0][1]).toBeNull();
  });

  it('calls onRangeSelect after dragging across multiple days', async () => {
    const onRangeSelect = vi.fn();
    const { container } = render(
      <DoctorYearView
        doctor={doctor}
        year={2099}
        shifts={[]}
        onToggle={vi.fn()}
        onRangeSelect={onRangeSelect}
      />,
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockColorSettingList).toHaveBeenCalled());

    const startButton = container.querySelector('button[title$="10.01.2099"]');
    const endButton = container.querySelector('button[title$="12.01.2099"]');

    expect(startButton).not.toBeNull();
    expect(endButton).not.toBeNull();

    fireEvent.mouseDown(startButton as HTMLButtonElement);
    fireEvent.mouseEnter(endButton as HTMLButtonElement);
    fireEvent.mouseUp(window);

    expect(onRangeSelect).toHaveBeenCalledOnce();
    expect(onRangeSelect.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(onRangeSelect.mock.calls[0][1]).toBeInstanceOf(Date);
  });

  it('opens the email dialog and sends absence email to the calendar address', async () => {
    render(
      <DoctorYearView doctor={doctor} year={2099} shifts={[makeShift()]} onToggle={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(await screen.findByRole('button', { name: /Abwesenheiten senden/i }));
    expect(screen.getByText(/alice.calendar@example.com/)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Jetzt senden/i }));

    await waitFor(() => {
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice.calendar@example.com',
          subject: '[CuraFlow] Deine Abwesenheiten',
        }),
      );
    });
  });
});
