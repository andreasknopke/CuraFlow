import { describe, expect, it, vi } from 'vitest';
import { ensureColumn, ensureColumns, listColumns } from '../schema.js';

describe('server schema utils', () => {
  it('lists columns using a safely quoted table identifier', async () => {
    const execute = vi.fn().mockResolvedValue([[{ Field: 'id' }, { Field: 'name' }]]);

    await expect(listColumns({ execute }, 'TeamRole')).resolves.toEqual(['id', 'name']);
    expect(execute).toHaveBeenCalledWith('SHOW COLUMNS FROM `TeamRole`');
  });

  it('adds only missing columns and tolerates duplicate field races', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[{ Field: 'id' }]])
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ER_DUP_FIELDNAME' }))
      .mockResolvedValueOnce([{}]);

    const addedColumns = await ensureColumns({ execute }, 'TeamRole', [
      { name: 'id', definition: 'VARCHAR(36)' },
      { name: 'priority', definition: 'INT NOT NULL DEFAULT 0' },
      { name: 'description', definition: 'VARCHAR(255) DEFAULT NULL' },
    ]);

    expect(addedColumns).toBe(1);
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'ALTER TABLE `TeamRole` ADD COLUMN `priority` INT NOT NULL DEFAULT 0',
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE `TeamRole` ADD COLUMN `description` VARCHAR(255) DEFAULT NULL',
    );
  });

  it('rejects invalid SQL identifiers before executing any query', async () => {
    const execute = vi.fn();

    await expect(ensureColumn({ execute }, 'TeamRole;DROP', 'status', 'INT')).rejects.toThrow(
      'Invalid SQL identifier',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
