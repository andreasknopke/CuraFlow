import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Video, VideoOff, X, Users, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/api/client';

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

function buildJitsiUrl({ baseUrl, roomName, token }) {
  return (
    `${baseUrl}/${roomName}?jwt=${encodeURIComponent(token)}&lang=de` +
    `#config.startWithAudioMuted=true` +
    `&config.startWithVideoMuted=true` +
    `&config.prejoinPageEnabled=false` +
    `&config.disableDeepLinking=true`
  );
}

export default function CoWorkWidget() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [isOpen, setIsOpen] = useState(false);
  const [isTriggerHidden, setIsTriggerHidden] = useState(false);
  const [position, setPosition] = useState({ x: null, y: null }); // null = CSS-Default
  const [jitsiSession, setJitsiSession] = useState(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef(null);
  const hideTimerRef = useRef(null);

  const tenantSlug = parseTenantSlug(user?.allowed_tenants);
  const roomName = `curaflow-support-${tenantSlug}`;
  const rawJitsiBaseUrl = import.meta.env.VITE_JITSI_BASE_URL || 'https://meet.jit.si';
  const jitsiBaseUrl = rawJitsiBaseUrl.replace(/\/$/, '');
  const jitsiUrl = jitsiSession?.token
    ? buildJitsiUrl({
        baseUrl: jitsiBaseUrl,
        roomName: jitsiSession.roomName || roomName,
        token: jitsiSession.token,
      })
    : null;

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
    if (!isOpen || !isAuthenticated || !isAdmin) return;

    let cancelled = false;

    const loadJitsiSession = async () => {
      setIsLoadingSession(true);
      setJitsiSession(null);
      try {
        const session = await api.getJitsiToken();
        if (!cancelled) {
          setJitsiSession(session);
        }
      } catch (error) {
        if (!cancelled) {
          setJitsiSession(null);
          toast.error(error.message || 'Jitsi-Token konnte nicht geladen werden');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSession(false);
        }
      }
    };

    loadJitsiSession();

    return () => {
      cancelled = true;
    };
  }, [isOpen, isAuthenticated, isAdmin]);

  // Nur für Admins sichtbar – NACH allen Hooks
  if (!isAuthenticated || !isAdmin) return null;

  /** @type {React.CSSProperties} */
  const panelStyle = position.x !== null
    ? { position: 'fixed', left: position.x, top: position.y, bottom: 'auto', right: 'auto' }
    : { position: 'fixed', bottom: 80, right: 20 };

  return (
    <>
      {/* Floating-Toggle-Button */}
      <button
        onClick={() => {
          setIsOpen((v) => {
            const nextOpen = !v;
            if (!nextOpen) {
              setJitsiSession(null);
            }
            return nextOpen;
          });
          setIsTriggerHidden(false);
        }}
        title={isOpen ? 'CoWork beenden' : 'CoWork-Session starten'}
        className={`
          fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-3
          shadow-lg text-sm font-medium transition-all duration-200
          ${!isOpen && isTriggerHidden ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100'}
          ${isOpen
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white'}
        `}
      >
        {isOpen ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        <span className="hidden sm:inline">{isOpen ? 'Session beenden' : 'CoWork'}</span>
      </button>

      {/* CoWork-Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={{ ...panelStyle, zIndex: 9999, width: 480, maxWidth: 'calc(100vw - 32px)' }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
        >
          {/* Header – Drag-Handle */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white cursor-move select-none"
            onMouseDown={onMouseDown}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="font-semibold text-sm">CoWork – {tenantSlug}</span>
            </div>
            <button
              onClick={() => {
                setJitsiSession(null);
                setIsOpen(false);
              }}
              className="rounded-full p-1 hover:bg-indigo-500 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Raum-Info */}
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
            <span className="text-xs text-indigo-700 flex-1 truncate">
              Geschuetzter Raum: <strong>{jitsiSession?.roomName || roomName}</strong>
            </span>
            <a
              href={jitsiUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              title="Im Browser öffnen"
              aria-disabled={!jitsiUrl}
              className={
                `shrink-0 p-1 rounded transition-colors ${jitsiUrl
                  ? 'text-indigo-500 hover:text-indigo-800 hover:bg-indigo-100'
                  : 'text-slate-300 pointer-events-none'}`
              }
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Jitsi iFrame */}
          {isLoadingSession ? (
            <div className="flex h-[360px] items-center justify-center bg-slate-50 text-slate-600">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Jitsi-Session wird vorbereitet...
              </div>
            </div>
          ) : jitsiUrl ? (
            <iframe
              src={jitsiUrl}
              allow="camera; microphone; display-capture; fullscreen; autoplay"
              style={{ width: '100%', height: 360, border: 'none', display: 'block' }}
              title="CoWork-Session"
            />
          ) : (
            <div className="flex h-[360px] items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-600">
              Die CoWork-Session konnte nicht gestartet werden. Bitte pruefen Sie die Jitsi-JWT-Konfiguration.
            </div>
          )}
        </div>
      )}
    </>
  );
}
