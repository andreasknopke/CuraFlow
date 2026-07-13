import { describe, expect, it } from 'vitest';
import type { Doctor } from '@/types';

import { buildWishFulfillmentStats } from '../wishFulfillmentUtils';

const makeDoctor = (id: string, name: string, role = ''): Doctor => ({
  id,
  name,
  role,
  fte: 1,
  exclude_from_staffing_plan: false,
  order: 0,
  is_active: true,
  created_date: '',
  updated_date: '',
});

describe('buildWishFulfillmentStats', () => {
  it('calculates fulfillment from each doctors own shifts across wish ranges', () => {
    const stats = buildWishFulfillmentStats({
      doctors: [
        makeDoctor('doctor-anna', 'Anna Adler', 'doctor'),
        makeDoctor('doctor-bert', 'Bert Braun', 'doctor'),
      ],
      wishes: [
        {
          id: 'wish-anna-service',
          doctor_id: 'doctor-anna',
          type: 'service',
          start_date: '2026-05-01',
          end_date: '2026-05-03',
          status: 'approved',
        },
        {
          id: 'wish-anna-free',
          doctor_id: 'doctor-anna',
          type: 'free',
          date: '2026-05-04',
          status: 'rejected',
        },
        {
          id: 'wish-bert-service',
          doctor_id: 'doctor-bert',
          type: 'service',
          date: '2026-05-02',
          status: 'approved',
        },
      ] as any,
      shifts: [
        {
          id: 'shift-anna-service',
          doctor_id: 'doctor-anna',
          date: '2026-05-02',
          position: 'Dienst Vordergrund',
        },
        {
          id: 'shift-anna-rotation',
          doctor_id: 'doctor-anna',
          date: '2026-05-04',
          position: 'Sono Rotation',
        },
        {
          id: 'shift-bert-other',
          doctor_id: 'doctor-bert',
          date: '2026-05-02',
          position: 'Sono Rotation',
        },
        {
          id: 'shift-unrelated',
          doctor_id: 'doctor-other',
          date: '2026-05-02',
          position: 'Dienst Hintergrund',
        },
      ] as any,
    });

    expect(stats).toEqual([
      {
        name: 'Anna Adler',
        role: 'doctor',
        total: 2,
        fulfilled: 2,
        rate: 100,
        approved: 1,
        rejected: 1,
      },
      {
        name: 'Bert Braun',
        role: 'doctor',
        total: 1,
        fulfilled: 0,
        rate: 0,
        approved: 1,
        rejected: 0,
      },
    ]);
  });
});
