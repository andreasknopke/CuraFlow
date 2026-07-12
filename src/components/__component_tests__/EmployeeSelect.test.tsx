import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EmployeeSelect from '@/components/staff/EmployeeSelect';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

describe('EmployeeSelect', () => {
  const options = [
    {
      value: '2',
      label: 'Beate Zimmer',
      description: 'Oberarzt',
      searchText: 'BZ Oberarzt',
      sortLabel: 'Beate Zimmer',
    },
    {
      value: '1',
      label: 'Anna Meyer',
      description: 'Assistenzarzt',
      searchText: 'AM Assistenzarzt',
      sortLabel: 'Anna Meyer',
    },
  ];

  it('filters employees by quick search and updates the selected value', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    renderWithProviders(
      <EmployeeSelect
        value=""
        onValueChange={handleChange}
        options={options}
        placeholder="Person auswählen"
      />
    );

    await user.click(screen.getByRole('combobox', { name: /person auswählen/i }));
    await user.type(screen.getByPlaceholderText('Mitarbeiter suchen...'), 'anna');

    expect(screen.getByText('Anna Meyer')).toBeInTheDocument();
    expect(screen.queryByText('Beate Zimmer')).not.toBeInTheDocument();

    await user.click(screen.getByText('Anna Meyer'));

    expect(handleChange).toHaveBeenCalledWith('1');
  });

  it('supports descending sorting from the popover', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <EmployeeSelect
        value=""
        onValueChange={() => {}}
        options={options}
        placeholder="Person auswählen"
      />
    );

    await user.click(screen.getByRole('combobox', { name: /person auswählen/i }));
    await user.click(screen.getByRole('button', { name: /z-a/i }));

    const renderedOptions = screen.getAllByRole('option');

    expect(renderedOptions[0]).toHaveTextContent('Beate Zimmer');
    expect(renderedOptions[1]).toHaveTextContent('Anna Meyer');
  });
});