import React, { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/components/AuthProvider';
import { getActiveDbToken } from '@/components/dbTokenStorage.jsx';

const ENTITY_QUERY_KEYS = {
  ShiftEntry: [['shifts'], ['shifts-history']],
  ScheduleNote: [['scheduleNotes']],
  StaffingPlanEntry: [['staffingPlanEntries']],
  Doctor: [['doctors'], ['staffingPlanEntries'], ['doctorQualifications'], ['allDoctorQualifications']],
  Workplace: [['workplaces'], ['workplaceTimeslots'], ['workplaceQualifications'], ['allWorkplaceQualifications']],
  WorkplaceTimeslot: [['workplaceTimeslots'], ['shifts']],
  TrainingRotation: [['trainingRotations'], ['shifts']],
  ScheduleRule: [['scheduleRules']],
  ColorSetting: [['colorSettings']],
  TeamRole: [['teamRoles'], ['doctors']],
  Qualification: [['qualifications'], ['doctorQualifications'], ['workplaceQualifications'], ['allDoctorQualifications'], ['allWorkplaceQualifications']],
  DoctorQualification: [['doctorQualifications'], ['allDoctorQualifications']],
  WorkplaceQualification: [['workplaceQualifications'], ['allWorkplaceQualifications']],
  WishRequest: [['wishes'], ['dashboardAlert']],
  SystemSetting: [['systemSettings']],
};

function getQueryKeysForEntity(entity) {
  return ENTITY_QUERY_KEYS[entity] || [['shifts'], ['scheduleNotes'], ['staffingPlanEntries']];
}

function buildRealtimeUrl() {
  const token = api.getToken();
  if (!token) return null;

  const params = new URLSearchParams({ access_token: token });
  const dbToken = getActiveDbToken();
  if (dbToken) {
    params.set('db_token', dbToken);
  }

  const baseUrl = api.baseURL || '';
  return `${baseUrl}/api/auth/events/stream?${params.toString()}`;
}

export default function PlanUpdateListener() {
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const pendingKeysRef = useRef(new Map());
  const pendingPayloadsRef = useRef([]);
  const flushTimerRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const streamUrl = buildRealtimeUrl();
    if (!streamUrl) return undefined;

    const eventSource = new EventSource(streamUrl);

    const flushPendingUpdates = () => {
      flushTimerRef.current = null;

      for (const queryKey of pendingKeysRef.current.values()) {
        queryClient.invalidateQueries({ queryKey });
      }

      const payloads = pendingPayloadsRef.current;
      const foreignChange = payloads.find((payload) => payload?.actor?.email && payload.actor.email !== user?.email);
      if (foreignChange) {
        const actorLabel = foreignChange.actor.email;
        toast.info(`Plan aktualisiert durch ${actorLabel}`, {
          id: 'plan-update-notification',
          duration: 4000,
        });
      }

      pendingKeysRef.current.clear();
      pendingPayloadsRef.current = [];
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = window.setTimeout(flushPendingUpdates, 300);
    };

    const handlePlanUpdate = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const queryKeys = getQueryKeysForEntity(payload.entity);

        for (const queryKey of queryKeys) {
          pendingKeysRef.current.set(JSON.stringify(queryKey), queryKey);
        }

        pendingPayloadsRef.current.push(payload);
        scheduleFlush();
      } catch (error) {
        console.warn('[PlanUpdateListener] Konnte Realtime-Event nicht verarbeiten:', error);
      }
    };

    eventSource.addEventListener('plan-update', handlePlanUpdate);
    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        console.warn('[PlanUpdateListener] Realtime-Verbindung geschlossen');
      }
    };

    return () => {
      eventSource.removeEventListener('plan-update', handlePlanUpdate);
      eventSource.close();
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingKeysRef.current.clear();
      pendingPayloadsRef.current = [];
    };
  }, [isAuthenticated, queryClient, user?.email]);

  return null;
}