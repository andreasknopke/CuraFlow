import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Loader2, HelpCircle, AlertCircle, Volume2, Radio, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuCheckboxItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { base44 } from '@/api/base44Client';
import { format, startOfWeek, addDays } from 'date-fns';
import { de } from 'date-fns/locale';
import VoiceTrainingDialog from './VoiceTrainingDialog';
import { useElevenLabsConversation } from '@/components/useElevenLabsConversation';

// CONFIG: Set your Agent ID here or via Environment Variable if possible
const ELEVENLABS_AGENT_ID = "agent_1901kb1v556ke8trk5g98xjaxrp4"; // <-- INSERT AGENT ID HERE

export default function VoiceControl({ doctors, workplaces, currentDate, onVoiceCommand }) {
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState(null);
    
    // Modes: 'browser' (Google), 'transcribe' (ElevenLabs STT), 'agent' (ElevenLabs ConvAI)
    const [mode, setMode] = useState('agent'); 
    
    const [showTraining, setShowTraining] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    
    const recognitionRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    
    // Agent Hook
    const { 
        status: agentStatus, 
        isSpeaking: agentIsSpeaking, 
        startConversation: startAgent, 
        stopConversation: stopAgent 
    } = useElevenLabsConversation({
        agentId: ELEVENLABS_AGENT_ID,
        onConnect: () => {
            setIsListening(true);
            setTranscript("Verbunden mit Agent...");
        },
        onDisconnect: () => {
            setIsListening(false);
            setTranscript("");
        },
        onError: (err) => {
            console.error("Agent Error", err);
            setError("Agent Fehler: " + err.message);
            setIsListening(false);
        },
        onMessage: (msg) => {
            // Handle custom tool calls or transcripts from agent if needed
            console.log("Agent Message:", msg);
        }
    });

    // Use ref to access latest handleSendText function in the recognition callback
    // This prevents stale closures where doctors/workplaces lists are empty
    const handleSendTextRef = useRef(null);
    
    // Check browser support for Web Speech API
    const isWebSpeechSupported = typeof window !== 'undefined' && 
        (window.SpeechRecognition || window.webkitSpeechRecognition);

    useEffect(() => {
        if (isWebSpeechSupported && !recognitionRef.current) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            
            recognition.continuous = false; // Stop after one sentence for immediate processing
            recognition.interimResults = true;
            recognition.lang = 'de-DE';

            recognition.onstart = () => {
                console.log("VoiceControl: Recognition started");
                setIsListening(true);
                setError(null);
                setTranscript("");
            };

            recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                setTranscript(finalTranscript || interimTranscript);

                if (finalTranscript) {
                    // Auto-submit on final result
                    if (handleSendTextRef.current) {
                        handleSendTextRef.current(finalTranscript);
                    }
                }
            };

            recognition.onerror = (event) => {
                console.error("VoiceControl: Speech recognition error", event.error);
                if (event.error === 'not-allowed') {
                    setError("Mikrofonzugriff verweigert.");
                } else if (event.error === 'no-speech') {
                    // Ignore no-speech, just stop
                } else {
                    setError("Fehler: " + event.error);
                }
                setIsListening(false);
            };

            recognition.onend = () => {
                console.log("VoiceControl: Recognition ended");
                if (mode === 'browser') setIsListening(false);
            };

            recognitionRef.current = recognition;
        }
    }, [isWebSpeechSupported, mode]);

    const startRecording = async () => {
        console.log("VoiceControl: Starting recording (ElevenLabs mode)");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                console.log("VoiceControl: Recording stopped, processing audio...");
                // Ensure listening state is off (in case of external stop)
                setIsListening(false);
                
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                
                // Convert to Base64
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    
                    setIsProcessing(true);
                    setTranscript("Transkribiere Audio...");
                    console.log("VoiceControl: Sending audio to backend...");
                    
                    try {
                        const res = await base44.functions.invoke('transcribeAudio', { 
                            audioBase64: base64Audio 
                        });
                        
                        const text = res.data.text;
                        console.log("VoiceControl: Transcription received:", text);
                        
                        if (text) {
                            setTranscript(text);
                            handleSendTextRef.current(text);
                        } else {
                            setError("Kein Text erkannt.");
                            setIsProcessing(false); // Reset processing if no text to process further
                        }
                    } catch (e) {
                        console.error("VoiceControl: Transcription failed", e);
                        setError("Transkriptionsfehler: " + (e.response?.data?.error || e.message));
                        setIsProcessing(false);
                    } finally {
                        // Stop tracks
                        stream.getTracks().forEach(track => track.stop());
                    }
                };
            };

            mediaRecorder.start();
            setIsListening(true);
            setError(null);
        } catch (e) {
            console.error("VoiceControl: Error starting recording:", e);
            setError("Mikrofonfehler: " + e.message);
            setIsListening(false); // Ensure state reset
        }
    };

    const stopRecording = () => {
        console.log("VoiceControl: Stopping recording...");
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            // Also stop all tracks explicitly to release microphone
            if (mediaRecorderRef.current?.stream) {
                mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            }
        } catch (e) {
            console.error("VoiceControl: Error stopping media recorder:", e);
        } finally {
            // Always ensure state is reset
            setIsListening(false);
        }
    };

    const toggleListening = () => {
        if (mode === 'agent') {
            if (isListening || agentStatus === 'connected') {
                stopAgent();
            } else {
                if (!ELEVENLABS_AGENT_ID) {
                    alert("Bitte konfigurieren Sie zuerst die ElevenLabs Agent ID im Code.");
                    return;
                }
                startAgent();
            }
            return;
        }

        if (mode === 'transcribe') {
            if (isListening) {
                stopRecording();
            } else {
                startRecording();
            }
        } else {
            // Browser Mode
            if (!isWebSpeechSupported) {
                alert("Ihr Browser unterstützt keine Spracherkennung. Bitte nutzen Sie Google Chrome oder wechseln Sie den Modus.");
                return;
            }

            if (isListening) {
                recognitionRef.current?.stop();
            } else {
                try {
                    recognitionRef.current?.start();
                } catch (e) {
                    console.error(e);
                }
            }
        }
    };

    // Update ref on every render to keep it fresh
    useEffect(() => {
        handleSendTextRef.current = handleSendText;
    });

    const handleSendText = async (text) => {
        if (!text || !text.trim()) return;
        
        setIsProcessing(true);
        
        try {
            const start = startOfWeek(currentDate, { weekStartsOn: 1 });
            const weekContext = Array.from({ length: 7 }).map((_, i) => {
                const d = addDays(start, i);
                return `${format(d, 'EEEE', { locale: de })}: ${format(d, 'yyyy-MM-dd')}`;
            }).join('\n');

            const context = {
                doctors: doctors.map(d => ({ name: d.name, id: d.id })),
                workplaces: workplaces.map(w => ({ name: w.name })),
                currentDate: format(currentDate, 'yyyy-MM-dd'),
                weekContext: weekContext
            };

            const response = await base44.functions.invoke('processVoiceAudio', {
                text: text,
                context: context
            });
            
            const result = response.data;
            console.log("Voice Result:", result);
            
            if (result.corrected_text) {
                setTranscript(result.corrected_text);
            }
            
            onVoiceCommand(result);
            
        } catch (err) {
            console.error("Error processing voice:", err);
            // Try to extract backend error message if available
            const msg = err.response?.data?.error || err.message || "Verarbeitungsfehler";
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
                        variant={isListening ? "destructive" : "outline"}
                        size="icon"
                        onClick={toggleListening}
                        disabled={isProcessing || (mode === 'browser' && !isWebSpeechSupported)}
                        className={`rounded-full w-10 h-10 shadow-sm transition-all ${isProcessing ? 'opacity-80' : ''} ${isListening ? 'animate-pulse ring-4 ring-red-100 scale-110' : 'hover:bg-slate-100'}`}
                        title={mode === 'agent' ? "Agent starten" : mode === 'transcribe' ? "Aufnahme (HQ)" : "Spracheingabe"}
                    >
                        {isProcessing ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : isListening ? (
                            mode === 'agent' ? <Bot className="w-5 h-5 animate-bounce" /> : <MicOff className="w-5 h-5" />
                        ) : (
                            mode === 'agent' ? <Bot className="w-5 h-5" /> : <Mic className="w-5 h-5" />
                        )}
                    </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuCheckboxItem checked={mode === 'browser'} onCheckedChange={() => setMode('browser')}>
                        <Mic className="w-4 h-4 mr-2" /> Browser
                    </ContextMenuCheckboxItem>
                    <ContextMenuCheckboxItem checked={mode === 'transcribe'} onCheckedChange={() => setMode('transcribe')}>
                        <Volume2 className="w-4 h-4 mr-2" /> ElevenLabs (HQ Transkription)
                    </ContextMenuCheckboxItem>
                    <ContextMenuCheckboxItem checked={mode === 'agent'} onCheckedChange={() => setMode('agent')}>
                        <Bot className="w-4 h-4 mr-2" /> ElevenLabs Agent (Standard)
                    </ContextMenuCheckboxItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => setShowTraining(true)}>
                        <Volume2 className="w-4 h-4 mr-2" />
                        Sprachmodell trainieren
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setShowHelp(true)}>
                        <HelpCircle className="w-4 h-4 mr-2" />
                        Hilfe
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
            
            {/* Live Feedback & Processing Status */}
            {(isListening || isProcessing || transcript || error) && (
                <div className={`hidden md:block absolute top-full left-0 mt-2 text-xs px-3 py-1 rounded-lg z-50 whitespace-nowrap shadow-lg border transition-colors ${
                    error ? 'bg-red-50 text-red-600 border-red-200' :
                    isProcessing ? 'bg-indigo-600 text-white border-indigo-700' : 
                    isListening ? 'bg-slate-800 text-white border-slate-900' :
                    'bg-white text-slate-700 border-slate-200'
                }`}>
                    {error ? (
                        <div className="flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</div>
                    ) : (
                        <div className="max-w-[300px] overflow-hidden text-ellipsis">
                            {isListening && !transcript && "Ich höre zu..."}
                            {isProcessing && "Verarbeite..."}
                            {!isListening && !isProcessing && transcript && (
                                <span className="flex items-center gap-1">
                                    <span className="opacity-50">Erkannt:</span> "{transcript}"
                                </span>
                            )}
                            {isListening && transcript && `"${transcript}"`}
                        </div>
                    )}
                </div>
            )}
            
            <VoiceTrainingDialog 
                doctors={doctors} 
                isOpen={showTraining} 
                onOpenChange={setShowTraining} 
            />
            
            <Dialog open={showHelp} onOpenChange={setShowHelp}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Sprachsteuerung Hilfe</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                        <div className="text-slate-500 mb-2">
                            Nutzt die Google-Engine im Browser oder ElevenLabs für High-Quality Erkennung. Sprechen Sie klar und deutlich.
                        </div>
                        
                        <div className="flex items-center justify-between pt-2 border-t">
                            <label className="font-medium text-slate-700">Modus</label>
                            <span className="text-xs bg-slate-100 px-2 py-1 rounded">
                                {mode === 'browser' ? 'Browser' : mode === 'transcribe' ? 'HQ Transkription' : 'Agent (Live)'}
                            </span>
                        </div>

                        <div className="pt-2">
                            <h5 className="font-medium text-indigo-600 mb-1">Befehle</h5>
                            <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
                                <li>"Setze Müller auf CT"</li>
                                <li>"Verschiebe Meier auf MRT"</li>
                                <li>"Lösche Schmidt aus Montag"</li>
                                <li>"Nächste Woche" / "Heute"</li>
                            </ul>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}