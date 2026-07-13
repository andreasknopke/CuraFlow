import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WorkplaceConfigDialog from '@/components/settings/WorkplaceConfigDialog';
import TeamRoleSettings from '@/components/settings/TeamRoleSettings';
import QualificationManagement from '@/components/settings/QualificationManagement';
import ColorSettingsDialog from '@/components/settings/ColorSettingsDialog';
import SectionConfigDialog from '@/components/settings/SectionConfigDialog';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

// --- Shared mocks ---

const mocks = vi.hoisted(() => ({
  workplaceList: vi.fn(),
  workplaceCreate: vi.fn(),
  workplaceUpdate: vi.fn(),
  workplaceDelete: vi.fn(),
  systemSettingList: vi.fn(),
  systemSettingUpdate: vi.fn(),
  systemSettingCreate: vi.fn(),
  teamRoleList: vi.fn(),
  teamRoleCreate: vi.fn(),
  teamRoleUpdate: vi.fn(),
  teamRoleDelete: vi.fn(),
  colorSettingList: vi.fn(),
  colorSettingUpdate: vi.fn(),
  colorSettingCreate: vi.fn(),
  colorSettingDelete: vi.fn(),
  renamePosition: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  useQualifications: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: {
    renamePosition: mocks.renamePosition,
  },
  db: {
    Workplace: {
      list: mocks.workplaceList,
      create: mocks.workplaceCreate,
      update: mocks.workplaceUpdate,
      delete: mocks.workplaceDelete,
    },
    SystemSetting: {
      list: mocks.systemSettingList,
      update: mocks.systemSettingUpdate,
      create: mocks.systemSettingCreate,
    },
    TeamRole: {
      list: mocks.teamRoleList,
      create: mocks.teamRoleCreate,
      update: mocks.teamRoleUpdate,
      delete: mocks.teamRoleDelete,
    },
    ColorSetting: {
      list: mocks.colorSettingList,
      update: mocks.colorSettingUpdate,
      create: mocks.colorSettingCreate,
      delete: mocks.colorSettingDelete,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock('@/components/ui/dialog', () => {
  let capturedOnOpenChange: any = null;

  function MockDialog({ children, onOpenChange }: any) {
    capturedOnOpenChange = onOpenChange;
    return <>{children}</>;
  }

  function MockDialogTrigger({ children, ...props }: any) {
    // Don't wrap in <button> to avoid nested button issues;
    // the original component passes asChild which means the Button is the trigger.
    return (
      <span
        {...props}
        role="button"
        onClick={() => {
          props.onClick?.();
          capturedOnOpenChange?.(true);
        }}
      >
        {children}
      </span>
    );
  }

  return {
    Dialog: MockDialog,
    DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    DialogDescription: ({ children }: any) => <div>{children}</div>,
    DialogFooter: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <div>{children}</div>,
    DialogTrigger: MockDialogTrigger,
  };
});

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: any) => <>{children}</>,
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/admin/TimeslotEditor', () => ({
  default: () => <div data-testid="timeslot-editor" />,
}));

vi.mock('@/components/settings/WorkplaceQualificationEditor', () => ({
  default: () => <div data-testid="workplace-qualification-editor" />,
}));

vi.mock('@/hooks/useQualifications', () => ({
  useQualifications: mocks.useQualifications,
}));

// --- Tests ---

describe('SettingsDialogs smoke tests', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock: any) => mock.mockReset());

    (mocks.workplaceList as any).mockResolvedValue([
      { id: 1, name: 'CT', category: 'Rotationen', order: 1, active_days: [1, 2, 3, 4, 5] },
    ]);
    (mocks.systemSettingList as any).mockResolvedValue([]);
    (mocks.teamRoleList as any).mockResolvedValue([
      { id: 1, name: 'Chefarzt', priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Oberste Führungsebene' },
      { id: 2, name: 'Oberarzt', priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: '' },
      { id: 3, name: 'Facharzt', priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann alle Dienste' },
    ]);
    (mocks.colorSettingList as any).mockResolvedValue([]);
    (mocks.workplaceCreate as any).mockResolvedValue({ id: 99 });
    (mocks.workplaceUpdate as any).mockResolvedValue({});
    (mocks.workplaceDelete as any).mockResolvedValue({});
    (mocks.systemSettingUpdate as any).mockResolvedValue({});
    (mocks.systemSettingCreate as any).mockResolvedValue({});
    (mocks.teamRoleCreate as any).mockResolvedValue({ id: 99 });
    (mocks.teamRoleUpdate as any).mockResolvedValue({});
    (mocks.teamRoleDelete as any).mockResolvedValue({});

    (mocks.useQualifications as any).mockReturnValue({
      qualifications: [
        { id: 1, name: 'CT-Befundung', short_label: 'CT', category: 'Medizinisch', color_bg: '#e0e7ff', color_text: '#3730a3', is_active: true, requires_certificate: false },
        { id: 2, name: 'Notfall-Sono', short_label: 'SON', category: 'Medizinisch', color_bg: '#dbeafe', color_text: '#1e40af', is_active: true, requires_certificate: false },
      ],
      qualificationsByCategory: {
        'Medizinisch': [
          { id: 1, name: 'CT-Befundung', short_label: 'CT', category: 'Medizinisch', color_bg: '#e0e7ff', color_text: '#3730a3', is_active: true, requires_certificate: false },
          { id: 2, name: 'Notfall-Sono', short_label: 'SON', category: 'Medizinisch', color_bg: '#dbeafe', color_text: '#1e40af', is_active: true, requires_certificate: false },
        ],
      },
      categories: ['Medizinisch'],
      qualificationMap: {},
      isLoading: false,
      refetch: vi.fn(),
      createQualification: vi.fn(),
      updateQualification: vi.fn(),
      deleteQualification: vi.fn(),
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
    });

    window.confirm = vi.fn(() => true);
  });

  it('WorkplaceConfigDialog — renders with workplaces, tabs, and form fields visible', async () => {
    renderWithProviders(<WorkplaceConfigDialog defaultTab="Rotationen" />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByText('Konfiguration: Arbeitsplätze & Dienste')).toBeInTheDocument();
    expect(await screen.findByText('CT')).toBeInTheDocument();
    expect(screen.getByText('Neu anlegen')).toBeInTheDocument();
    expect(screen.getByText('Rotationen')).toBeInTheDocument();
  });

  it('WorkplaceConfigDialog — add new item triggers create', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkplaceConfigDialog defaultTab="Rotationen" />, {
      withAuthProvider: false,
      withToaster: false,
    });

    // Wait for workplace list to load
    expect(await screen.findByText('CT')).toBeInTheDocument();

    // Click "Neu anlegen" to add a new workplace
    await user.click(screen.getByText('Neu anlegen'));

    await waitFor(() => {
      expect(mocks.workplaceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Rotationen', name: expect.stringContaining('Neue Position') })
      );
    });
  });

  it('TeamRoleSettings — renders role list with badges', async () => {
    renderWithProviders(<TeamRoleSettings />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByText('Team-Funktionen verwalten')).toBeInTheDocument();
    expect(await screen.findByText('Chefarzt')).toBeInTheDocument();
    expect(screen.getByText('Oberarzt')).toBeInTheDocument();
    // "Facharzt" appears both as a role name and as a badge on Chefarzt
    expect(screen.getAllByText('Facharzt').length).toBeGreaterThanOrEqual(2);
    // "Neue Funktion hinzufügen" appears twice (button + edit dialog title)
    expect(screen.getAllByText('Neue Funktion hinzufügen').length).toBeGreaterThanOrEqual(1);
  });

  it('QualificationManagement — renders categories and qualification badges', async () => {
    renderWithProviders(<QualificationManagement />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByText('Qualifikationen verwalten')).toBeInTheDocument();
    // "Medizinisch" appears both as a category header and in the edit dialog category options
    expect(screen.getAllByText('Medizinisch').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CT-Befundung')).toBeInTheDocument();
    expect(screen.getByText('Notfall-Sono')).toBeInTheDocument();
    expect(screen.getByText('Neue Qualifikation hinzufügen')).toBeInTheDocument();
  });

  it('ColorSettingsDialog — renders with color rows and tab labels', async () => {
    renderWithProviders(<ColorSettingsDialog />, {
      withAuthProvider: false,
      withToaster: false,
    });

    expect(await screen.findByText('Farbeinstellungen')).toBeInTheDocument();
    expect(screen.getByText('Funktionen')).toBeInTheDocument();
    expect(screen.getByText('Arbeitsplätze')).toBeInTheDocument();
    expect(screen.getByText('Rotationen')).toBeInTheDocument();
    expect(screen.getByText('Abwesenheiten')).toBeInTheDocument();
    expect(screen.getByText('Bereiche')).toBeInTheDocument();
  });

  it('SectionConfigDialog — renders section list with buttons', async () => {
    renderWithProviders(<SectionConfigDialog />, {
      withAuthProvider: false,
      withToaster: false,
    });

    // Dialog mock renders children inline — the trigger button and content are both present
    expect(screen.getByTitle('Panel-Konfiguration')).toBeInTheDocument();
    expect(screen.getByText('Speichern')).toBeInTheDocument();
    expect(screen.getByText('Zurücksetzen')).toBeInTheDocument();
  });
});
