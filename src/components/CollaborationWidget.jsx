import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Video, VideoOff, Copy, Check, X, Users, ExternalLink } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';

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

export default function CollaborationWidget() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: null, y: null }); // null = CSS-Default
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef(null);

  const tenantSlug = parseTenantSlug(user?.allowed_tenants);
  const roomName = `curaflow-support-${tenantSlug}`;
  const publicLink = `https://meet.jit.si/${roomName}`;
  const displayName = encodeURIComponent(user?.full_name || user?.email || 'Admin');
  const jitsiUrl =
    `https://meet.jit.si/${roomName}` +
    `#config.startWithAudioMuted=true` +
    `&config.startWithVideoMuted=true` +
    `&config.prejoinPageEnabled=false` +
    `&config.disableDeepLinking=true` +
    `&config.defaultLanguage=de` +
    `&userInfo.displayName=${displayName}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(publicLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [publicLink]);

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
        onClick={() => setIsOpen((v) => !v)}
        title={isOpen ? 'Kollaboration beenden' : 'Kollaborationssession starten'}
        className={`
          fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-3
          shadow-lg text-sm font-medium transition-all duration-200
          ${isOpen
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white'}
        `}
      >
        {isOpen ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        <span className="hidden sm:inline">{isOpen ? 'Session beenden' : 'Kollaboration'}</span>
      </button>

      {/* Kollaborations-Panel */}
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
              <span className="font-semibold text-sm">Kollaboration – {tenantSlug}</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 hover:bg-indigo-500 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Raum-Info */}
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
            <span className="text-xs text-indigo-700 flex-1 truncate">
              Anderen Admin einladen: <strong>{publicLink}</strong>
            </span>
            <button
              onClick={handleCopy}
              title="Link kopieren"
              className="shrink-0 flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1 rounded hover:bg-indigo-100"
            >
              {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
            <a
              href={publicLink}
              target="_blank"
              rel="noopener noreferrer"
              title="Im Browser öffnen"
              className="shrink-0 text-indigo-500 hover:text-indigo-800 transition-colors p-1 rounded hover:bg-indigo-100"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Jitsi iFrame */}
          <iframe
            src={jitsiUrl}
            allow="camera; microphone; display-capture; fullscreen; autoplay"
            style={{ width: '100%', height: 360, border: 'none', display: 'block' }}
            title="Kollaborationssession"
          />
        </div>
      )}
    </>
  );
}
