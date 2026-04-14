declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
    chunksSent?: number;
  }
}

import { useState, useEffect, useRef, useMemo } from 'react';
import { Mic, MicOff, Loader2, HelpCircle, AlertCircle, Volume2, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { api, db } from '@/api/client';
import { format, startOfWeek, addDays, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { de } from 'date-fns/locale';
import VoiceTrainingDialog from './schedule/VoiceTrainingDialog';
import { useElevenLabsConversation } from '@/components/useElevenLabsConversation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStaffingCheck } from '@/components/useStaffingCheck';
import { useShiftLimitCheck } from '@/components/useShiftLimitCheck';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/components/AuthProvider';

interface GVCDoctor {
  id: number;
  name: string;
  initials?: string;
  doctor_id?: number;
  [key: string]: unknown;
}

interface GVCWorkplace {
  id: number;
  name: string;
  category?: string;
  service_type?: number;
  order?: number;
  allows_rotation_concurrently?: boolean;
  allows_consecutive_days?: boolean;
  consecutive_days_mode?: string;
  [key: string]: unknown;
}

interface GVCShiftEntry {
  id: number;
  doctor_id: number;
  date: string;
  position: string;
  order?: number;
  [key: string]: unknown;
}

// CONFIG: Set your Agent ID here or via Environment Variable if possible
const ELEVENLABS_AGENT_ID = 'agent_1901kb1v556ke8trk5g98xjaxrp4';
const ELEVENLABS_AGENT_ID_SECONDARY = 'agent_0601kb68g27kfbq90tqrq18xr80e';

export default function GlobalVoiceControl() {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentDate, _setCurrentDate] = useState(new Date());

  // Modes: 'browser' (Google), 'transcribe' (ElevenLabs STT), 'agent' (ElevenLabs ConvAI)
  const [mode, setMode] = useState('agent');
  const { isReadOnly, user } = useAuth();

  const firstCallRef = useRef(true);
  const [activeAgentId, setActiveAgentId] = useState(ELEVENLABS_AGENT_ID);

  const [showTraining, setShowTraining] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const recognitionRef = useRef<unknown>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const handleSendTextRef = useRef<((text: string) => Promise<void>) | null>(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  // --- DATA FETCHING (Replicated from ScheduleBoard for global access) ---
  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors'],
    queryFn: () => db.Doctor.list(),
  }) as { data: GVCDoctor[] };

  const { data: workplaces = [] } = useQuery({
    queryKey: ['workplaces'],
    queryFn: () => (db.Workplace.list as (...args: unknown[]) => unknown)(null, 1000),
  }) as { data: GVCWorkplace[] };

  // Fetch shifts around today to handle commands
  const fetchRange = useMemo(() => {
    const start = startOfMonth(addMonths(currentDate, -1));
    const end = endOfMonth(addMonths(currentDate, 1));
    return {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
    };
  }, [currentDate]);

  const { data: allShifts = [] } = useQuery({
    queryKey: ['shifts', fetchRange.start, fetchRange.end],
    queryFn: () =>
      (db.ShiftEntry.filter as (...args: unknown[]) => unknown)(
        {
          date: { $gte: fetchRange.start, $lte: fetchRange.end },
        },
        null,
        5000,
      ),
    placeholderData: (prev: unknown) => prev,
  }) as { data: GVCShiftEntry[] };

  const { checkStaffing } = useStaffingCheck(
    doctors as unknown as { id: number; role?: string; [key: string]: unknown }[] | undefined,
    allShifts as unknown as
      | { id: number; doctor_id: number; date: string; position: string; [key: string]: unknown }[]
      | undefined,
  );
  const { checkLimits } = useShiftLimitCheck(
    allShifts as unknown as
      | { id: number; doctor_id: number; date: string; position: string; [key: string]: unknown }[]
      | undefined,
    workplaces as unknown as
      | {
          id: number;
          name: string;
          category?: string;
          service_type?: number;
          order?: number;
          [key: string]: unknown;
        }[]
      | undefined,
  );

  const absencePositions = ['Frei', 'Krank', 'Urlaub', 'Dienstreise', 'Nicht verfügbar'];

  // --- CONFLICT CHECKS ---
  const checkConflicts = (
    doctorId: number,
    dateStr: string,
    newPosition: string,
    isVoice = false,
  ) => {
    const doctorShiftsOnDate = allShifts.filter(
      (s: GVCShiftEntry) => s.doctor_id === doctorId && s.date === dateStr,
    );

    const blockingPositions = ['Frei', 'Krank', 'Urlaub', 'Nicht verfügbar'];
    const blockingShift = doctorShiftsOnDate.find((s) => blockingPositions.includes(s.position));

    if (blockingShift) {
      const msg = `Mitarbeiter ist an diesem Tag bereits als "${blockingShift.position}" eingeteilt.`;
      if (isVoice) toast.error(msg);
      return true;
    }

    const dienstreiseShift = doctorShiftsOnDate.find((s) => s.position === 'Dienstreise');
    if (dienstreiseShift) {
      if (isVoice) {
        toast.warning(
          `Konflikt: Mitarbeiter ist auf "Dienstreise". Manuelle Bestätigung erforderlich.`,
        );
        return true;
      }
    }

    const rotationPositions = workplaces
      .filter((w) => w.category === 'Rotationen')
      .map((w) => w.name);
    const exclusiveServices = workplaces
      .filter((w) => w.category === 'Dienste' && w.allows_rotation_concurrently === false)
      .map((w) => w.name);

    const isNewRotation = rotationPositions.includes(newPosition);
    const newServiceWorkplace = workplaces.find(
      (w) => w.name === newPosition && w.category === 'Dienste',
    );
    const isNewService = !!newServiceWorkplace;

    if (isNewService) {
      // Determine consecutive mode: 'forbidden' | 'allowed' | 'preferred'
      const consecutiveMode =
        newServiceWorkplace.consecutive_days_mode ||
        (newServiceWorkplace.allows_consecutive_days === false ? 'forbidden' : 'allowed');
      if (consecutiveMode === 'forbidden') {
        const currentDt = new Date(dateStr);
        const prevDateStr = format(addDays(currentDt, -1), 'yyyy-MM-dd');
        const nextDateStr = format(addDays(currentDt, 1), 'yyyy-MM-dd');

        const hasConsecutive = allShifts.some(
          (s) =>
            s.doctor_id === doctorId &&
            s.position === newPosition &&
            (s.date === prevDateStr || s.date === nextDateStr),
        );

        if (hasConsecutive) {
          const msg = `Konflikt: "${newPosition}" ist nicht an aufeinanderfolgenden Tagen erlaubt.`;
          if (isVoice) toast.error(msg);
          return true;
        }
      }
    }

    if (isNewRotation) {
      const conflictShift = doctorShiftsOnDate.find((s) => exclusiveServices.includes(s.position));
      if (conflictShift) {
        const msg = `Konflikt: Mitarbeiter hat bereits "${conflictShift.position}" (blockiert Rotation).`;
        if (isVoice) toast.error(msg);
        return true;
      }
    }

    if (isNewService) {
      if (newServiceWorkplace.allows_rotation_concurrently === false) {
        const conflictShift = doctorShiftsOnDate.find((s) =>
          rotationPositions.includes(s.position),
        );
        if (conflictShift) {
          const msg = `Konflikt: Mitarbeiter ist bereits in Rotation "${conflictShift.position}" und Dienst erlaubt keine Rotation.`;
          if (isVoice) toast.error(msg);
          return true;
        }
      }
    }
    return false;
  };

  // --- COMMAND HANDLER ---
  const onVoiceCommand = async (command: Record<string, unknown>) => {
    console.log('Global Voice Command:', command);

    if (command.action === 'unknown') {
      toast.error(String(command.reason || 'Konnte den Befehl nicht verstehen.'));
      return;
    }

    const resolveDoctor = (idOrName: unknown): GVCDoctor | null => {
      if (!idOrName) return null;
      const term = idOrName.toString().trim();
      const lower = term.toLowerCase();
      let doc = doctors.find((d) => String(d.id) === term);
      if (doc) return doc;
      doc = doctors.find(
        (d) => d.name.toLowerCase() === lower || (d.initials && d.initials.toLowerCase() === lower),
      );
      if (doc) return doc;
      doc = doctors.find((d) => d.name.toLowerCase().includes(lower));
      if (doc) return doc;
      doc = doctors.find((d) => lower.includes(d.name.toLowerCase()));
      if (doc) return doc;
      const parts = lower.split(/\s+/).filter((p) => p.length > 2);
      for (const part of parts) {
        doc = doctors.find((d) => d.name.toLowerCase().includes(part));
        if (doc) return doc;
      }
      return null;
    };

    const resolvePosition = (name: unknown): string | null => {
      if (!name) return null;
      const nameStr = String(name);
      let wp = workplaces.find((w) => w.name === nameStr);
      if (wp) return wp.name;
      const lower = nameStr.toLowerCase();
      wp = workplaces.find((w) => w.name.toLowerCase() === lower);
      if (wp) return wp.name;
      wp = workplaces.find(
        (w) => w.name.toLowerCase().includes(lower) || lower.includes(w.name.toLowerCase()),
      );
      if (wp) return wp.name;
      return nameStr;
    };

    try {
      let _actionHandled = false;
      let updatesCount = 0;
      let skippedCount = 0;

      if (command.action === 'navigate' && command.navigation) {
        // TODO: Pass params to schedule page
        // Simple navigation for now
        navigate(createPageUrl('Schedule'));
        toast.success('Navigiere zum Wochenplan...');
        _actionHandled = true;
      }

      if (command.action === 'assign') {
        if (!command.assignments || (command.assignments as unknown[]).length === 0) {
          toast.warning('Keine Zuweisungen gefunden.');
          _actionHandled = true;
        } else {
          const toCreate: { date: unknown; position: string; doctor_id: number; order: number }[] =
            [];
          const toUpdate: { id: unknown; data: Record<string, unknown> }[] = [];

          for (const assignment of command.assignments as Record<string, unknown>[]) {
            const { doctor_id, position, date } = assignment;
            const doc = resolveDoctor(doctor_id);
            const posName = resolvePosition(position);

            if (!doc || !posName) {
              toast.error(`Konnte Arzt oder Position nicht finden.`);
              skippedCount++;
              continue;
            }

            if (absencePositions.includes(posName)) {
              const warning = checkStaffing(String(date), doc.id);
              if (warning) toast.warning(warning);
            } else {
              const limitWarning = checkLimits(doc.id, String(date), posName);
              if (limitWarning) toast.warning(limitWarning);
              if (checkConflicts(doc.id, String(date), posName, true)) {
                skippedCount++;
                continue;
              }
            }

            const existingShift = allShifts.find((s) => s.date === date && s.position === posName);

            if (existingShift) {
              if (existingShift.doctor_id !== doc.id) {
                toUpdate.push({ id: existingShift.id, data: { doctor_id: doc.id } });
              }
            } else {
              const cellShifts = allShifts.filter((s) => s.date === date && s.position === posName);
              const pendingInCell = toCreate.filter(
                (s) => s.date === date && s.position === posName,
              );
              const maxOrder = Math.max(
                cellShifts.reduce((max, s) => Math.max(max, s.order || 0), -1),
                pendingInCell.reduce((max, s) => Math.max(max, s.order || 0), -1),
              );
              toCreate.push({ date, position: posName, doctor_id: doc.id, order: maxOrder + 1 });
            }
          }

          if (toCreate.length > 0) await db.ShiftEntry.bulkCreate(toCreate);
          if (toUpdate.length > 0)
            await Promise.all(
              toUpdate.map((item) => db.ShiftEntry.update(item.id as number, item.data)),
            );

          updatesCount = toCreate.length + toUpdate.length;
          if (updatesCount > 0) toast.success(`${updatesCount} Zuweisung(en) durchgeführt`);
          else if (skippedCount > 0) toast.error(`${skippedCount} Fehler/Konflikte.`);

          _actionHandled = true;
        }
      }

      if (command.action === 'move') {
        if (!command.move) {
          toast.warning('Keine Verschiebungsinformationen.');
          _actionHandled = true;
        } else {
          const { doctor_id, source_position, target_position, source_date, target_date } =
            command.move as Record<string, unknown>;
          const doc = resolveDoctor(doctor_id);

          if (doc) {
            const tDate = target_date || source_date;
            const tPos = resolvePosition(target_position);
            const sPos = resolvePosition(source_position);
            const promises: Promise<unknown>[] = [];

            if (tPos) {
              let shift = null;
              if (sPos) {
                shift = allShifts.find(
                  (s) => s.date === source_date && s.position === sPos && s.doctor_id === doc.id,
                );
              } else {
                shift = allShifts.find((s) => s.date === source_date && s.doctor_id === doc.id);
              }

              if (shift) {
                promises.push(db.ShiftEntry.update(shift.id, { position: tPos, date: tDate }));
              } else {
                toast.warning(`Kein Dienst gefunden.`);
              }
            } else if (source_date && tDate && source_date !== tDate) {
              const shifts = allShifts.filter(
                (s) => s.date === source_date && s.doctor_id === doc.id,
              );
              shifts.forEach((s) => promises.push(db.ShiftEntry.update(s.id, { date: tDate })));
            }

            if (promises.length > 0) {
              await Promise.all(promises);
              updatesCount = promises.length;
              toast.success('Verschiebung durchgeführt');
            }
          }
          _actionHandled = true;
        }
      }

      if (command.action === 'delete') {
        if (!command.delete) {
          toast.warning('Keine Löschinformationen.');
          _actionHandled = true;
        } else {
          const { doctor_id, scope, date } = command.delete as Record<string, unknown>;
          const doc = resolveDoctor(doctor_id);

          if (doc) {
            let idsToDelete: number[] = [];
            if (scope === 'day' && date) {
              const shifts = allShifts.filter((s) => s.date === date && s.doctor_id === doc.id);
              idsToDelete = shifts.map((s) => s.id);
            } else if (scope === 'week') {
              const start = startOfWeek(currentDate, { weekStartsOn: 1 });
              const startStr = format(start, 'yyyy-MM-dd');
              const endStr = format(addDays(start, 6), 'yyyy-MM-dd');
              const shifts = allShifts.filter(
                (s) => s.doctor_id === doc.id && s.date >= startStr && s.date <= endStr,
              );
              idsToDelete = shifts.map((s) => s.id);
            }

            if (idsToDelete.length > 0) {
              await Promise.all(idsToDelete.map((id) => db.ShiftEntry.delete(id)));
              toast.success(`${idsToDelete.length} gelöscht`);
              updatesCount = idsToDelete.length;
            }
          }
          _actionHandled = true;
        }
      }

      if (updatesCount > 0) {
        queryClient.invalidateQueries({ queryKey: ['shifts'] });
      }
    } catch (err: unknown) {
      console.error('Voice Execution Error:', err);
      toast.error('Fehler: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // --- VOICE AGENT LOGIC (From original component) ---

  const clientTools = useMemo(
    () => ({
      get_current_context: async (parameters: Record<string, unknown>) => {
        console.log('Agent asks for context', parameters);

        // Map path to readable name
        const path = location.pathname;
        let area = 'Unbekannt';
        if (path === '/' || path.toLowerCase().includes('home')) area = 'Startseite';
        else if (path.includes('Schedule')) area = 'Wochenplan';
        else if (path.includes('MyDashboard')) area = 'Mein Dashboard';
        else if (path.includes('ServiceStaffing')) area = 'Dienstbesetzung';
        else if (path.includes('Staff')) area = 'Team';
        else if (path.includes('Vacation')) area = 'Abwesenheiten';
        else if (path.includes('WishList')) area = 'Wunschkiste';
        else if (path.includes('Training')) area = 'Ausbildung';
        else if (path.includes('Statistics')) area = 'Statistik';
        else if (path.includes('Help')) area = 'Hilfe';
        else if (path.includes('Admin')) area = 'Adminbereich';

        // Check for open dialogs (heuristic)
        const dialogs = document.querySelectorAll('[role="dialog"]');
        let activeOverlay = 'keines';
        if (dialogs.length > 0) {
          const lastDialog = dialogs[dialogs.length - 1];
          const title = (lastDialog.querySelector('h2') as HTMLElement)?.innerText || 'Dialog';
          activeOverlay = title;
        }

        return JSON.stringify({
          page: area,
          path: path,
          active_overlay: activeOverlay,
          user_status: 'eingeloggt',
        });
      },
    }),
    [location.pathname],
  );

  // Agent Hook
  const {
    status: agentStatus,
    isSpeaking: _agentIsSpeaking,
    startConversation: startAgent,
    stopConversation: stopAgent,
  } = useElevenLabsConversation({
    agentId: activeAgentId,
    clientTools,
    onConnect: () => {
      setIsListening(true);
      setTranscript('Verbunden mit Agent...');
    },
    onDisconnect: () => {
      setIsListening(false);
      setTranscript('');
    },
    onError: (err: unknown) => {
      console.error('Agent Error', err);
      setError('Agent Fehler: ' + (err instanceof Error ? err.message : String(err)));
      setIsListening(false);
    },
    onMessage: (msg) => {
      console.log('Agent Message:', msg);
    },
  });

  // Check browser support for Web Speech API
  const isWebSpeechSupported =
    typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (isReadOnly) {
      setMode('agent');
    }
  }, [isReadOnly]);

  useEffect(() => {
    handleSendTextRef.current = handleSendText;
  });

  useEffect(() => {
    if (isWebSpeechSupported && !recognitionRef.current) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'de-DE';

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
        setTranscript('');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
          else interim += event.results[i][0].transcript;
        }
        setTranscript(final || interim);
        if (final && handleSendTextRef.current) {
          handleSendTextRef.current(final);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') setError('Mikrofonzugriff verweigert.');
        else if (event.error !== 'no-speech') setError('Fehler: ' + event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        if (mode === 'browser') setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [isWebSpeechSupported, mode]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const _base64Audio = reader.result;
          setIsProcessing(true);
          setTranscript('Transkribiere Audio...');
          try {
            const text = (await api.transcribeAudio(audioBlob)) as string;
            if (text) {
              setTranscript(text);
              handleSendTextRef.current?.(text);
            } else {
              setError('Kein Text erkannt.');
              setIsProcessing(false);
            }
          } catch (_e) {
            setError('Transkriptionsfehler');
            setIsProcessing(false);
          } finally {
            stream.getTracks().forEach((track) => track.stop());
          }
        };
      };

      mediaRecorder.start();
      setIsListening(true);
      setError(null);
    } catch (e: unknown) {
      setError('Mikrofonfehler: ' + (e instanceof Error ? e.message : String(e)));
      setIsListening(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    setIsListening(false);
  };

  const toggleListening = () => {
    if (mode === 'agent') {
      if (isListening || agentStatus === 'connected') stopAgent();
      else {
        let userNameVar = '';

        if (firstCallRef.current) {
          let specificName = '';
          // Try to find doctor name
          if (user?.doctor_id) {
            const doc = doctors.find((d) => d.id === user.doctor_id);
            if (doc) {
              specificName = `Doktor ${doc.name}`;
            }
          }

          if (specificName) {
            userNameVar = `Guten Tag, ${specificName}!`;
          } else {
            // Fallback if no doctor assigned
            const roleName = user?.role === 'admin' ? 'Administrator' : 'User';
            userNameVar = `Guten Tag, ${roleName}!`;
          }
        }

        const userRole = user?.role === 'admin' ? 'Admin' : 'User';

        startAgent({
          dynamicVariables: {
            User_Name: userNameVar,
            User_Rolle: userRole,
            First_Call: firstCallRef.current,
          },
        });

        // Set first call to false after first usage and switch agent ID
        if (firstCallRef.current) {
          firstCallRef.current = false;
          // Switch to secondary agent for next call
          setActiveAgentId(ELEVENLABS_AGENT_ID_SECONDARY);
        }
      }
      return;
    }
    if (mode === 'transcribe') {
      if (isListening) stopRecording();
      else startRecording();
    } else {
      if (isListening) (recognitionRef.current as any)?.stop();
      else (recognitionRef.current as any)?.start();
    }
  };

  const handleSendText = async (text: string) => {
    if (!text || !text.trim()) return;
    setIsProcessing(true);

    try {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const weekContext = Array.from({ length: 7 })
        .map((_, i) => {
          const d = addDays(start, i);
          return `${format(d, 'EEEE', { locale: de })}: ${format(d, 'yyyy-MM-dd')}`;
        })
        .join('\n');

      const _context = {
        doctors: doctors.map((d) => ({ name: d.name, id: d.id })),
        workplaces: workplaces.map((w) => ({ name: w.name })),
        currentDate: format(currentDate, 'yyyy-MM-dd'),
        weekContext: weekContext,
      };

      const result = (await api.processVoiceCommand(text)) as Record<string, unknown>;
      if (result.corrected_text) setTranscript(result.corrected_text as string);
      onVoiceCommand(result);
    } catch (err: unknown) {
      const msg =
        (
          err as Record<string, unknown> & {
            response?: { data?: { error?: string } };
            message?: string;
          }
        )?.response?.data?.error ||
        (err instanceof Error ? err.message : null) ||
        'Verarbeitungsfehler';
      setError(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex items-center gap-1 relative">
      <ContextMenu>
        <ContextMenuTrigger>
          <Button
            variant={isListening ? 'destructive' : 'outline'}
            size="icon"
            onClick={toggleListening}
            disabled={isProcessing || (mode === 'browser' && !isWebSpeechSupported)}
            className={`rounded-full w-10 h-10 shadow-sm transition-all ${isProcessing ? 'opacity-80' : ''} ${isListening ? 'animate-pulse ring-4 ring-red-100 scale-110' : 'hover:bg-slate-100'}`}
            title={
              mode === 'agent'
                ? 'Agent starten'
                : mode === 'transcribe'
                  ? 'Aufnahme (HQ)'
                  : 'Spracheingabe'
            }
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isListening ? (
              mode === 'agent' ? (
                <Bot className="w-5 h-5 animate-bounce" />
              ) : (
                <MicOff className="w-5 h-5" />
              )
            ) : mode === 'agent' ? (
              <Bot className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {!isReadOnly && (
            <>
              <ContextMenuCheckboxItem
                checked={mode === 'browser'}
                onCheckedChange={() => setMode('browser')}
              >
                <Mic className="w-4 h-4 mr-2" /> Browser
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem
                checked={mode === 'transcribe'}
                onCheckedChange={() => setMode('transcribe')}
              >
                <Volume2 className="w-4 h-4 mr-2" /> ElevenLabs (HQ Transkription)
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem
                checked={mode === 'agent'}
                onCheckedChange={() => setMode('agent')}
              >
                <Bot className="w-4 h-4 mr-2" /> ElevenLabs Agent (Standard)
              </ContextMenuCheckboxItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => setShowTraining(true)}>
                <Volume2 className="w-4 h-4 mr-2" />
                Sprachmodell trainieren
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onClick={() => setShowHelp(true)}>
            <HelpCircle className="w-4 h-4 mr-2" />
            Hilfe
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {(isListening || isProcessing || transcript || error) && (
        <div
          className={`absolute top-full left-0 mt-2 text-xs px-3 py-1 rounded-lg z-50 whitespace-nowrap shadow-lg border transition-colors bg-white text-slate-700 border-slate-200`}
        >
          {error ? (
            <div className="flex items-center gap-1 text-red-600">
              <AlertCircle className="w-3 h-3" /> {error}
            </div>
          ) : (
            <div className="max-w-[300px] overflow-hidden text-ellipsis">
              {isListening && !transcript && 'Ich höre zu...'}
              {isProcessing && 'Verarbeite...'}
              {transcript}
            </div>
          )}
        </div>
      )}

      <VoiceTrainingDialog doctors={doctors} isOpen={showTraining} onOpenChange={setShowTraining} />

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sprachsteuerung Hilfe</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>Nutzen Sie den Bot, um den Dienstplan zu bearbeiten.</p>
            <ul className="list-disc pl-4">
              <li>"Setze Müller auf CT heute"</li>
              <li>"Verschiebe den Dienst von morgen auf übermorgen"</li>
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
