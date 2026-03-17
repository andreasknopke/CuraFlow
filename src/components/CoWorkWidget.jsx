import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Video, VideoOff, X, Users, Loader2, PhoneCall, PhoneIncoming, PhoneOff, Maximize2, Minimize2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/api/client';
import { useMasterAuth } from '@/master/MasterAuthProvider';

let jitsiExternalApiLoader = null;
let jitsiExternalApiScriptUrl = null;

/**
 * Leitet den ersten Mandanten-Slug aus dem allowed_tenants-Feld ab.
 * Gibt einen sicheren ASCII-Slug zurück, der als Jitsi-Raumname genutzt wird.
 */
function parseTenantSlug(allowed_tenants) {
  if (!allowed_tenants) return 'default';
  try {
    // Könnte ein JSON-Array-String sein: '["Krankenhaus_A","Krankenhaus_B"]'
    const parsed = JSON.parse(allowed_tenants);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0].toString().toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
    }
  } catch {
    // Kein JSON → direkter String
  }
  return allowed_tenants.toString().toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
}

function buildJitsiDomain(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function loadJitsiExternalApi(baseUrl) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Jitsi kann nur im Browser geladen werden'));
  }

  if (window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI);
  }

  const scriptUrl = `${baseUrl}/external_api.js`;
  if (jitsiExternalApiLoader && jitsiExternalApiScriptUrl === scriptUrl) {
    return jitsiExternalApiLoader;
  }

  jitsiExternalApiScriptUrl = scriptUrl;
  jitsiExternalApiLoader = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[data-jitsi-external-api="true"][src="${scriptUrl}"]`);

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.JitsiMeetExternalAPI), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Jitsi-API konnte nicht geladen werden')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.dataset.jitsiExternalApi = 'true';
    script.onload = () => {
      if (window.JitsiMeetExternalAPI) {
        resolve(window.JitsiMeetExternalAPI);
        return;
      }

      reject(new Error('Jitsi-API ist nach dem Laden nicht verfuegbar'));
    };
    script.onerror = () => reject(new Error('Jitsi-API konnte nicht geladen werden'));
    document.body.appendChild(script);
  });

  return jitsiExternalApiLoader;
}

function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'offline';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000));
  if (diffSeconds < 60) return 'gerade eben';
  if (diffSeconds < 3600) return `vor ${Math.floor(diffSeconds / 60)} min`;

  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(lastSeenAt));
}

function formatExpiry(expiresDate) {
  if (!expiresDate) return 'offen';

  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(expiresDate));
}

function getInviteToastId(inviteId) {
  return `cowork-invite-${inviteId}`;
}

export default function CoWorkWidget() {
  const appAuth = useAuth();
  const masterAuth = useMasterAuth();
  const queryClient = useQueryClient();
  const authState = masterAuth?.isAuthenticated ? masterAuth : appAuth;
  const { user, isAuthenticated } = authState;
  const isAdmin = user?.role === 'admin';

  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isContactsCollapsed, setIsContactsCollapsed] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isTriggerHidden, setIsTriggerHidden] = useState(false);
  const [position, setPosition] = useState({ x: null, y: null }); // null = CSS-Default
  const [activeSession, setActiveSession] = useState(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [hiddenInviteIds, setHiddenInviteIds] = useState([]);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef(null);
  const jitsiContainerRef = useRef(null);
  const jitsiApiRef = useRef(null);
  const hideTimerRef = useRef(null);
  const announcedInviteIdsRef = useRef(new Set());
  const lastInviteErrorRef = useRef(null);

  const tenantSlug = parseTenantSlug(user?.allowed_tenants);
  const rawJitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || 'https://meet.jit.si';
  const jitsiBaseUrl = rawJitsiBaseUrl.replace(/\/$/, '');
  const jitsiDomain = buildJitsiDomain(jitsiBaseUrl);
  const activeRoomName = activeSession?.roomName || null;

  const invitesQuery = useQuery({
    queryKey: ['coworkInvites'],
    queryFn: () => api.listCoworkInvites(),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? 3000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const contactsQuery = useQuery({
    queryKey: ['coworkContacts'],
    queryFn: () => api.listCoworkContacts(),
    enabled: isAuthenticated && isAdmin && isOpen,
    refetchInterval: isAuthenticated && isAdmin && isOpen ? 15000 : false,
  });

  const hideInviteLocally = useCallback((inviteId) => {
    if (!inviteId) return;
    setHiddenInviteIds((currentIds) => (
      currentIds.includes(inviteId) ? currentIds : [...currentIds, inviteId]
    ));
  }, []);

  const showInviteLocally = useCallback((inviteId) => {
    if (!inviteId) return;
    setHiddenInviteIds((currentIds) => currentIds.filter((currentId) => currentId !== inviteId));
  }, []);

  const incomingInvites = (invitesQuery.data?.incoming || []).filter((invite) => !hiddenInviteIds.includes(invite.id));
  const outgoingInvites = invitesQuery.data?.outgoing || [];
  const currentIncomingInvite = incomingInvites[0] || null;
  const sortedContacts = [...(contactsQuery.data || [])].sort((left, right) => {
    if (left.is_online !== right.is_online) {
      return left.is_online ? -1 : 1;
    }
    return (left.full_name || left.email).localeCompare(right.full_name || right.email, 'de');
  });

  const refreshCoworkData = useCallback(async () => {
    await invitesQuery.refetch();
    if (isAdmin && isOpen) {
      await contactsQuery.refetch();
    }
  }, [contactsQuery, invitesQuery, isAdmin, isOpen]);

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (isOpen) {
      setIsTriggerHidden(false);
      return;
    }
    hideTimerRef.current = setTimeout(() => {
      setIsTriggerHidden(true);
    }, 8000);
  }, [clearHideTimer, isOpen]);

  const handleToggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined' || !panelRef.current) return;

    try {
      if (document.fullscreenElement === panelRef.current) {
        await document.exitFullscreen();
        return;
      }

      await panelRef.current.requestFullscreen();
    } catch {
      toast.error('Vollbild konnte nicht aktiviert werden');
    }
  }, []);

  const joinInviteInternal = useCallback(async (inviteId) => {
    setBusyId(inviteId);
    setIsLoadingSession(true);

    try {
      const session = await api.joinCoworkInvite(inviteId);
      toast.dismiss(getInviteToastId(inviteId));
      setActiveSession(session);
      setIsContactsCollapsed(true);
      setIsOpen(true);
      await refreshCoworkData();
      return session;
    } catch (error) {
      toast.error(error.message || 'CoWork-Session konnte nicht geoeffnet werden');
      return null;
    } finally {
      setBusyId(null);
      setIsLoadingSession(false);
    }
  }, [refreshCoworkData]);

  const handleOpenDefaultRoom = useCallback(async () => {
    setBusyId('default-room');
    setIsLoadingSession(true);

    try {
      const session = await api.getJitsiToken();
      setActiveSession(session);
      setIsContactsCollapsed(true);
      setIsOpen(true);
    } catch (error) {
      toast.error(error.message || 'Jitsi-Session konnte nicht geladen werden');
    } finally {
      setBusyId(null);
      setIsLoadingSession(false);
    }
  }, []);

  const handleSendInvite = useCallback(async (contact) => {
    setBusyId(contact.id);
    setIsLoadingSession(true);

    try {
      const result = await api.sendCoworkInvite(contact.id);
      setActiveSession(result.session);
      setIsContactsCollapsed(true);
      setIsOpen(true);
      toast.success(`Einladung an ${contact.full_name || contact.email} gesendet`);
      await refreshCoworkData();
    } catch (error) {
      toast.error(error.message || 'Einladung konnte nicht gesendet werden');
    } finally {
      setBusyId(null);
      setIsLoadingSession(false);
    }
  }, [refreshCoworkData]);

  const handleJoinInvite = useCallback(async (inviteId) => {
    await joinInviteInternal(inviteId);
  }, [joinInviteInternal]);

  const handleDeclineInvite = useCallback(async (inviteId) => {
    setBusyId(inviteId);
    hideInviteLocally(inviteId);
    toast.dismiss(getInviteToastId(inviteId));
    try {
      await api.declineCoworkInvite(inviteId);
      toast.success('Einladung abgelehnt');
      if (activeSession?.inviteId === inviteId) {
        setActiveSession(null);
      }
      await refreshCoworkData();
    } catch (error) {
      showInviteLocally(inviteId);
      toast.error(error.message || 'Einladung konnte nicht abgelehnt werden');
    } finally {
      setBusyId(null);
    }
  }, [activeSession?.inviteId, hideInviteLocally, refreshCoworkData, showInviteLocally]);

  const handleCancelInvite = useCallback(async (inviteId) => {
    setBusyId(inviteId);
    hideInviteLocally(inviteId);
    toast.dismiss(getInviteToastId(inviteId));
    try {
      await api.cancelCoworkInvite(inviteId);
      toast.success('Einladung abgebrochen');
      if (activeSession?.inviteId === inviteId) {
        setActiveSession(null);
      }
      await refreshCoworkData();
    } catch (error) {
      showInviteLocally(inviteId);
      toast.error(error.message || 'Einladung konnte nicht abgebrochen werden');
    } finally {
      setBusyId(null);
    }
  }, [activeSession?.inviteId, hideInviteLocally, refreshCoworkData, showInviteLocally]);

  const handleCloseSession = useCallback(async () => {
    const inviteId = activeSession?.inviteId;

    setIsScreenSharing(false);

    if (!inviteId) {
      setActiveSession(null);
      setIsExpanded(false);
      setIsOpen(false);
      return;
    }

    setBusyId(inviteId);
    hideInviteLocally(inviteId);
    toast.dismiss(getInviteToastId(inviteId));
    try {
      await api.cancelCoworkInvite(inviteId);
      setActiveSession(null);
      setIsExpanded(false);
      setIsOpen(false);
      await refreshCoworkData();
    } catch (error) {
      showInviteLocally(inviteId);
      toast.error(error.message || 'CoWork-Session konnte nicht beendet werden');
    } finally {
      setBusyId(null);
    }
  }, [activeSession?.inviteId, hideInviteLocally, refreshCoworkData, showInviteLocally]);

  // Drag-Logik für das Panel
  const onMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('iframe')) return;
    dragging.current = true;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    scheduleHide();
    return clearHideTimer;
  }, [scheduleHide, clearHideTimer]);

  useEffect(() => {
    if (!activeSession) return;
    setIsContactsCollapsed(true);
  }, [activeSession]);

  useEffect(() => {
    const activeIncomingIds = new Set((invitesQuery.data?.incoming || []).map((invite) => invite.id));
    setHiddenInviteIds((currentIds) => currentIds.filter((inviteId) => activeIncomingIds.has(inviteId)));
  }, [invitesQuery.data?.incoming]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === panelRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!activeSession?.token || !activeRoomName || !jitsiDomain || !jitsiContainerRef.current) return undefined;

    let disposed = false;
    let externalApi = null;

    setIsLoadingSession(true);
    setIsScreenSharing(false);

    void loadJitsiExternalApi(jitsiBaseUrl)
      .then((JitsiMeetExternalAPI) => {
        if (disposed || !jitsiContainerRef.current) return;

        jitsiContainerRef.current.innerHTML = '';
        externalApi = new JitsiMeetExternalAPI(jitsiDomain, {
          roomName: activeRoomName,
          parentNode: jitsiContainerRef.current,
          jwt: activeSession.token,
          width: '100%',
          height: '100%',
          userInfo: {
            displayName: user?.full_name || user?.email || 'CuraFlow',
            email: user?.email || undefined,
          },
          configOverwrite: {
            startWithAudioMuted: true,
            startWithVideoMuted: true,
            prejoinPageEnabled: false,
            disableDeepLinking: true,
          },
        });

        jitsiApiRef.current = externalApi;
        externalApi.addEventListeners({
          videoConferenceJoined: () => {
            setIsLoadingSession(false);
          },
          screenSharingStatusChanged: (event) => {
            const sharingActive = Boolean(event?.on);
            setIsScreenSharing(sharingActive);

            if (sharingActive) {
              setIsTriggerHidden(true);
            }
          },
        });

        setIsLoadingSession(false);
      })
      .catch((error) => {
        if (disposed) return;

        setActiveSession(null);
        setIsLoadingSession(false);
        toast.error(error.message || 'Jitsi-Session konnte nicht geladen werden');
      });

    return () => {
      disposed = true;
      setIsScreenSharing(false);

      if (jitsiApiRef.current === externalApi) {
        jitsiApiRef.current = null;
      }

      if (externalApi?.dispose) {
        externalApi.dispose();
      }

      if (jitsiContainerRef.current) {
        jitsiContainerRef.current.innerHTML = '';
      }
    };
  }, [activeRoomName, activeSession?.token, jitsiBaseUrl, jitsiDomain, user?.email, user?.full_name]);

  useEffect(() => {
    if (!activeSession) return undefined;

    const syncInterval = window.setInterval(() => {
      queryClient.refetchQueries({ type: 'active' });
    }, 10000);

    return () => {
      window.clearInterval(syncInterval);
    };
  }, [activeSession, queryClient]);

  useEffect(() => {
    const onMouseMove = (e) => {
      const nearRightEdge = window.innerWidth - e.clientX <= 140;
      const nearBottomEdge = window.innerHeight - e.clientY <= 140;
      if (!nearRightEdge || !nearBottomEdge) return;
      setIsTriggerHidden(false);
      scheduleHide();
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [scheduleHide]);

  useEffect(() => {
    if (!currentIncomingInvite || currentIncomingInvite.status !== 'pending' || announcedInviteIdsRef.current.has(currentIncomingInvite.id)) return;

    announcedInviteIdsRef.current.add(currentIncomingInvite.id);
    setIsTriggerHidden(false);
    setIsOpen(true);
    toast.info(`Support-Einladung von ${currentIncomingInvite.inviter_name || currentIncomingInvite.inviter_email}`, {
      id: getInviteToastId(currentIncomingInvite.id),
      duration: 15000,
      action: {
        label: 'Beitreten',
        onClick: () => {
          void joinInviteInternal(currentIncomingInvite.id);
        },
      },
    });
  }, [currentIncomingInvite, joinInviteInternal]);

  useEffect(() => {
    const message = invitesQuery.error?.message || null;
    if (!message || lastInviteErrorRef.current === message) return;

    lastInviteErrorRef.current = message;
    toast.error(`CoWork-Einladungen konnten nicht geladen werden: ${message}`);
  }, [invitesQuery.error]);

  useEffect(() => {
    if (!currentIncomingInvite || currentIncomingInvite.status !== 'pending' || typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (document.visibilityState === 'visible') return;
    if (Notification.permission !== 'granted') return;

    const notification = new Notification('CuraFlow Support-Einladung', {
      body: `${currentIncomingInvite.inviter_name || currentIncomingInvite.inviter_email} hat Sie eingeladen.`,
      tag: `cowork-invite-${currentIncomingInvite.id}`,
    });

    notification.onclick = () => {
      window.focus();
      setIsOpen(true);
      void joinInviteInternal(currentIncomingInvite.id);
      notification.close();
    };

    return () => {
      notification.close();
    };
  }, [currentIncomingInvite, joinInviteInternal]);

  const shouldRender = isAuthenticated && (isAdmin || !!currentIncomingInvite || !!activeSession);
  if (!shouldRender) return null;

  const shouldShowIncomingPrompt = !!currentIncomingInvite && activeSession?.inviteId !== currentIncomingInvite.id;
  const isAcceptedIncomingInvite = currentIncomingInvite?.status === 'accepted';

  /** @type {React.CSSProperties} */
  const panelStyle = isExpanded
    ? { position: 'fixed', top: 20, right: 20, bottom: 20, left: 20 }
    : position.x !== null
      ? { position: 'fixed', left: position.x, top: position.y, bottom: 'auto', right: 'auto' }
      : { position: 'fixed', bottom: 80, right: 20 };
  const sessionHeight = isExpanded ? '100%' : 360;

  const triggerTone = currentIncomingInvite
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
    : isOpen
      ? 'bg-red-500 hover:bg-red-600 text-white'
      : 'bg-indigo-600 hover:bg-indigo-700 text-white';

  return (
    <>
      {!isScreenSharing && shouldShowIncomingPrompt && (
        <div className="fixed inset-x-4 top-20 z-[10000] mx-auto max-w-md rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-700">
              <PhoneIncoming className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">
                Support-Einladung von {currentIncomingInvite.inviter_name || currentIncomingInvite.inviter_email}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Raum {currentIncomingInvite.room_name} · gueltig bis {formatExpiry(currentIncomingInvite.expires_date)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => handleJoinInvite(currentIncomingInvite.id)}
              disabled={busyId === currentIncomingInvite.id || isLoadingSession}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyId === currentIncomingInvite.id && isLoadingSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3" />}
              Beitreten
            </button>
            <button
              onClick={() => (isAcceptedIncomingInvite ? handleCancelInvite(currentIncomingInvite.id) : handleDeclineInvite(currentIncomingInvite.id))}
              disabled={busyId === currentIncomingInvite.id}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PhoneOff className="h-3 w-3" />
              {isAcceptedIncomingInvite ? 'Entfernen' : 'Ablehnen'}
            </button>
          </div>
        </div>
      )}

      {/* Floating-Toggle-Button */}
      {!isScreenSharing && (
        <button
          onClick={() => {
            if (isOpen) {
              void handleCloseSession();
              return;
            }

            setIsOpen(true);
            setIsTriggerHidden(false);
          }}
          title={currentIncomingInvite ? 'Support-Einladung oeffnen' : (isOpen ? 'CoWork beenden' : 'CoWork starten')}
          className={`
            fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-3
            shadow-lg text-sm font-medium transition-all duration-200
            ${!isOpen && isTriggerHidden ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100'}
            ${triggerTone}
          `}
        >
          {currentIncomingInvite ? <PhoneIncoming className="h-4 w-4" /> : (isOpen ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />)}
          <span className="hidden sm:inline">
            {currentIncomingInvite ? 'Support' : (isOpen ? 'Session beenden' : 'CoWork')}
          </span>
        </button>
      )}

      {/* CoWork-Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={{
            ...panelStyle,
            zIndex: 9999,
            width: isExpanded ? 'auto' : 560,
            maxWidth: isExpanded ? 'none' : 'calc(100vw - 32px)',
            opacity: isScreenSharing ? 0 : 1,
            pointerEvents: isScreenSharing ? 'none' : 'auto',
            transform: isScreenSharing ? 'translateY(24px)' : 'translateY(0)',
          }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col transition-all duration-200"
        >
          {/* Header – Drag-Handle */}
          <div
            className={`flex items-center justify-between px-4 py-3 bg-indigo-600 text-white select-none ${isExpanded ? 'cursor-default' : 'cursor-move'}`}
            onMouseDown={isExpanded ? undefined : onMouseDown}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="font-semibold text-sm">CoWork Support - {tenantSlug}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded((currentValue) => !currentValue)}
                className="rounded-full p-1 hover:bg-indigo-500 transition-colors"
                title={isExpanded ? 'Fenster verkleinern' : 'Fenster vergroessern'}
              >
                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={() => { void handleCloseSession(); }}
                className="rounded-full p-1 hover:bg-indigo-500 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Raum-Info */}
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
            <span className="text-xs text-indigo-700 flex-1 truncate">
              Geschuetzter Raum: <strong>{activeRoomName || 'noch nicht gestartet'}</strong>
            </span>
            <button
              type="button"
              onClick={() => { void handleToggleFullscreen(); }}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 hover:text-indigo-900"
              title={isFullscreen ? 'Vollbild beenden' : 'Vollbild aktivieren'}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreen ? 'Vollbild beenden' : 'Vollbild'}
            </button>
          </div>

          {currentIncomingInvite && activeSession?.inviteId !== currentIncomingInvite.id && (
            <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-700">
                  <PhoneIncoming className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-emerald-950">
                    Support-Einladung von {currentIncomingInvite.inviter_name || currentIncomingInvite.inviter_email}
                  </div>
                  <div className="mt-1 text-xs text-emerald-800">
                    Raum {currentIncomingInvite.room_name} · gueltig bis {formatExpiry(currentIncomingInvite.expires_date)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => handleJoinInvite(currentIncomingInvite.id)}
                  disabled={busyId === currentIncomingInvite.id || isLoadingSession}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyId === currentIncomingInvite.id && isLoadingSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3" />}
                  Beitreten
                </button>
                <button
                  onClick={() => (isAcceptedIncomingInvite ? handleCancelInvite(currentIncomingInvite.id) : handleDeclineInvite(currentIncomingInvite.id))}
                  disabled={busyId === currentIncomingInvite.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PhoneOff className="h-3 w-3" />
                  {isAcceptedIncomingInvite ? 'Entfernen' : 'Ablehnen'}
                </button>
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Nutzer erreichen</div>
                    <div className="text-xs text-slate-500">Online-Admins koennen direkt in den Support-Raum eingeladen werden.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleOpenDefaultRoom}
                      disabled={busyId === 'default-room' || isLoadingSession}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyId === 'default-room' && isLoadingSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <Video className="h-3 w-3" />}
                      Raum ohne Einladung
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsContactsCollapsed((currentValue) => !currentValue)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      title={isContactsCollapsed ? 'Nutzerliste anzeigen' : 'Nutzerliste einklappen'}
                    >
                      {isContactsCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                      {isContactsCollapsed ? 'Nutzer anzeigen' : 'Nutzer einklappen'}
                    </button>
                  </div>
                </div>

                {!isContactsCollapsed && (
                  <div className="max-h-48 space-y-2 overflow-auto pr-1">
                    {contactsQuery.isLoading ? (
                      <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Kontakte werden geladen...
                      </div>
                    ) : sortedContacts.length > 0 ? (
                      sortedContacts.map((contact) => (
                        <div key={contact.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <div className={`h-2.5 w-2.5 rounded-full ${contact.is_online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">{contact.full_name || contact.email}</div>
                            <div className="truncate text-xs text-slate-500">{contact.email} · {contact.is_online ? 'online' : formatLastSeen(contact.last_seen_at)}</div>
                          </div>
                          <button
                            onClick={() => handleSendInvite(contact)}
                            disabled={!contact.is_online || busyId === contact.id}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {busyId === contact.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PhoneCall className="h-3 w-3" />}
                            Einladen
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                        Keine erreichbaren Admins gefunden.
                      </div>
                    )}
                  </div>
                )}

                {isContactsCollapsed && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                    Nutzerliste eingeklappt, damit mehr Platz fuer die aktive Besprechung bleibt.
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-slate-900">Ausgehende Einladungen</div>
                <div className="max-h-40 space-y-2 overflow-auto pr-1">
                  {outgoingInvites.length > 0 ? (
                    outgoingInvites.map((invite) => (
                      <div key={invite.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <div className={`rounded-full px-2 py-1 text-[11px] font-semibold ${invite.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {invite.status === 'accepted' ? 'angenommen' : 'wartet'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">{invite.invitee_name || invite.invitee_email}</div>
                          <div className="truncate text-xs text-slate-500">{invite.room_name} · bis {formatExpiry(invite.expires_date)}</div>
                        </div>
                        <button
                          onClick={() => handleJoinInvite(invite.id)}
                          disabled={busyId === invite.id}
                          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busyId === invite.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Video className="h-3 w-3" />}
                          Raum oeffnen
                        </button>
                        <button
                          onClick={() => handleCancelInvite(invite.id)}
                          disabled={busyId === invite.id}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Abbrechen
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
                      Noch keine offenen CoWork-Einladungen.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Jitsi iFrame */}
          {activeSession?.token && activeRoomName ? (
            <div className="relative bg-slate-950" style={{ height: sessionHeight, flex: isExpanded ? '1 1 auto' : '0 0 auto' }}>
              {isLoadingSession && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 text-slate-100">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Jitsi-Session wird vorbereitet...
                  </div>
                </div>
              )}
              <div
                ref={jitsiContainerRef}
                style={{ width: '100%', height: '100%', opacity: isLoadingSession ? 0.01 : 1 }}
              />
            </div>
          ) : isLoadingSession ? (
            <div className="flex min-h-[360px] items-center justify-center bg-slate-50 text-slate-600" style={{ height: sessionHeight, flex: isExpanded ? '1 1 auto' : '0 0 auto' }}>
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Jitsi-Session wird vorbereitet...
              </div>
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-600" style={{ height: sessionHeight, flex: isExpanded ? '1 1 auto' : '0 0 auto' }}>
              {isAdmin
                ? 'Waehlen Sie einen Nutzer fuer die Einladung aus oder oeffnen Sie einen allgemeinen Support-Raum.'
                : 'Es liegt aktuell keine aktive CoWork-Session vor.'}
            </div>
          )}
        </div>
      )}
    </>
  );
}
