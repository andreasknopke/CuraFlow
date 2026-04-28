import { useEffect, useRef } from 'react';
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

function describeRealtimeConnection(streamUrl) {
  if (!streamUrl) {
    return {
      streamPath: null,
      usesAccessToken: false,
      usesDbToken: false,
    };
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsedUrl = new URL(streamUrl, baseOrigin);
    return {
      streamPath: `${parsedUrl.pathname}${parsedUrl.searchParams.has('db_token') ? '?db_token=present' : ''}`,
      usesAccessToken: parsedUrl.searchParams.has('access_token'),
      usesDbToken: parsedUrl.searchParams.has('db_token'),
    };
  } catch {
    return {
      streamPath: '/api/auth/events/stream',
      usesAccessToken: true,
      usesDbToken: streamUrl.includes('db_token='),
    };
  }
}

const COWORK_QUERY_KEYS = [['coworkInvites'], ['coworkContacts']];

export default function PlanUpdateListener({ isAuthenticated: isAuthenticatedProp, user: userProp }) {
  const queryClient = useQueryClient();
  const authState = useAuth();
  const isAuthenticated = isAuthenticatedProp ?? authState.isAuthenticated;
  const user = userProp ?? authState.user;
  const isLoading = authState.isLoading ?? false;
  const authToken = authState.token || api.getToken();
  const activeDbToken = getActiveDbToken();
  const pendingKeysRef = useRef(new Map());
  const pendingPayloadsRef = useRef([]);
  const flushTimerRef = useRef(null);

  useEffect(() => {
    console.info('[PlanUpdateListener] Mount', {
      isLoading,
      isAuthenticated,
      userEmail: user?.email || null,
      hasAuthToken: !!authToken,
      hasDbToken: !!activeDbToken,
    });

    if (isLoading) {
      console.info('[PlanUpdateListener] Warte auf abgeschlossenen Auth-Check');
      return undefined;
    }

    if (!authToken) {
      console.warn('[PlanUpdateListener] Kein Stream, kein JWT vorhanden', {
        isAuthenticated,
        userEmail: user?.email || null,
        hasDbToken: !!activeDbToken,
      });
      return undefined;
    }

    const streamUrl = buildRealtimeUrl();
    if (!streamUrl) {
      console.warn('[PlanUpdateListener] Kein Stream, URL konnte nicht gebaut werden', {
        hasToken: !!api.getToken(),
        hasDbToken: !!getActiveDbToken(),
      });
      return undefined;
    }

    const eventSource = new EventSource(streamUrl);
    const streamDebug = describeRealtimeConnection(streamUrl);
    console.info('[PlanUpdateListener] Realtime-Verbindung wird aufgebaut', {
      ...streamDebug,
      isAuthenticated,
      userEmail: user?.email || null,
      hasDbToken: !!activeDbToken,
    });

    const flushPendingUpdates = () => {
      flushTimerRef.current = null;

      for (const queryKey of pendingKeysRef.current.values()) {
        queryClient.invalidateQueries({ queryKey });
      }

      const payloads = pendingPayloadsRef.current;
      console.info('[PlanUpdateListener] Invalidiere Queries nach Push-Event', {
        count: payloads.length,
        entities: payloads.map((payload) => payload.entity),
      });

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

        console.info('[PlanUpdateListener] Push-Event empfangen', payload);

        for (const queryKey of queryKeys) {
          pendingKeysRef.current.set(JSON.stringify(queryKey), queryKey);
        }

        pendingPayloadsRef.current.push(payload);
        scheduleFlush();
      } catch (error) {
        console.warn('[PlanUpdateListener] Konnte Realtime-Event nicht verarbeiten:', error);
      }
    };

    const handleCoworkUpdate = (event) => {
      try {
        const payload = JSON.parse(event.data);

        console.info('[PlanUpdateListener] CoWork-Push-Event empfangen', payload);
        for (const queryKey of COWORK_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey });
        }
      } catch (error) {
        console.warn('[PlanUpdateListener] Konnte CoWork-Event nicht verarbeiten:', error);
      }
    };

    eventSource.addEventListener('plan-update', handlePlanUpdate);
    eventSource.addEventListener('cowork-update', handleCoworkUpdate);
    eventSource.addEventListener('connected', () => {
      console.info('[PlanUpdateListener] Realtime-Verbindung aktiv');
    });
    eventSource.onerror = () => {
      console.warn('[PlanUpdateListener] Realtime-Fehler', { readyState: eventSource.readyState });
    };

    return () => {
      console.info('[PlanUpdateListener] Realtime-Verbindung wird beendet');
      eventSource.removeEventListener('plan-update', handlePlanUpdate);
      eventSource.removeEventListener('cowork-update', handleCoworkUpdate);
      eventSource.close();
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingKeysRef.current.clear();
      pendingPayloadsRef.current = [];
    };
  }, [activeDbToken, authToken, isAuthenticated, isLoading, queryClient, user?.email]);

  return null;
}