import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, MicOff, Loader2, Trash2, Plus, Volume2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { db } from '@/components/db';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { toast } from "sonner";
import { useAuth } from '@/components/AuthProvider';

export default function VoiceTrainingDialog({ doctors, isOpen: externalOpen, onOpenChange: externalOnOpenChange }) {
    const { user } = useAuth();
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
    const onOpenChange = externalOnOpenChange || setInternalOpen;
    const [selectedDoctor, setSelectedDoctor] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [detectedText, setDetectedText] = useState("");
    const [useElevenLabs, setUseElevenLabs] = useState(false);
    
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recognitionRef = useRef(null);
    const queryClient = useQueryClient();

    const isWebSpeechSupported = typeof window !== 'undefined' && 
        (window.SpeechRecognition || window.webkitSpeechRecognition);

    useEffect(() => {
        if (isWebSpeechSupported && !recognitionRef.current) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.lang = 'de-DE';

            recognition.onstart = () => {
                setIsRecording(true);
                setDetectedText("");
            };

            recognition.onresult = (event) => {
                const text = event.results[0][0].transcript;
                setDetectedText(text);
            };

            recognition.onerror = (event) => {
                console.error(event.error);
                setIsRecording(false);
                if (event.error !== 'no-speech') toast.error("Fehler: " + event.error);
            };

            recognition.onend = () => {
                if (!useElevenLabs) setIsRecording(false);
            };

            recognitionRef.current = recognition;
        }
    }, [isWebSpeechSupported, useElevenLabs]);

    const { data: aliases = [], isLoading } = useQuery({
        queryKey: ['voiceAliases'],
        queryFn: () => db.VoiceAlias.filter({ created_by: user?.email }),
        enabled: isOpen && !!user
    });

    const createAliasMutation = useMutation({
        mutationFn: (data) => db.VoiceAlias.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries(['voiceAliases']);
            setDetectedText("");
            toast.success("Alias gespeichert");
        }
    });

    const deleteAliasMutation = useMutation({
        mutationFn: (id) => db.VoiceAlias.delete(id),
        onSuccess: () => queryClient.invalidateQueries(['voiceAliases'])
    });

    const startRecording = async () => {
        if (!useElevenLabs && isWebSpeechSupported) {
            try {
                recognitionRef.current?.start();
            } catch (e) {
                console.error(e);
            }
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    setIsProcessing(true);
                    try {
                        const res = await base44.functions.invoke('transcribeAudio', { audioBase64: base64Audio });
                        if (res.data.text) {
                            setDetectedText(res.data.text);
                        } else {
                            toast.error("Kein Text erkannt");
                        }
                    } catch (e) {
                        console.error(e);
                        toast.error("Transkriptionsfehler");
                    } finally {
                        setIsProcessing(false);
                        stream.getTracks().forEach(track => track.stop());
                    }
                };
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (e) {
            console.error(e);
            toast.error("Mikrofonfehler: " + e.message);
        }
    };

    const stopRecording = () => {
        if (!useElevenLabs && isWebSpeechSupported) {
            recognitionRef.current?.stop();
            return;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
    };

    const handleSave = () => {
        if (!selectedDoctor || !detectedText) return;
        createAliasMutation.mutate({
            doctor_id: selectedDoctor.id,
            detected_text: detectedText
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            {externalOpen === undefined && (
                <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                        <Volume2 className="w-4 h-4" />
                        Training
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Sprach-Training</DialogTitle>
                </DialogHeader>
                
                <div className="flex flex-1 gap-4 min-h-0">
                    {/* Doctor List */}
                    <div className="w-1/3 border-r pr-4 flex flex-col">
                        <div className="font-medium mb-2 text-sm text-slate-500">Ärzte auswählen</div>
                        <ScrollArea className="flex-1">
                            <div className="space-y-1">
                                {doctors.map(doc => (
                                    <button
                                        key={doc.id}
                                        onClick={() => {
                                            setSelectedDoctor(doc);
                                            setDetectedText("");
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                                            selectedDoctor?.id === doc.id 
                                                ? 'bg-indigo-100 text-indigo-900 font-medium' 
                                                : 'hover:bg-slate-100 text-slate-700'
                                        }`}
                                    >
                                        {doc.name}
                                        {aliases.some(a => a.doctor_id === doc.id) && (
                                            <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Training Area */}
                    <div className="flex-1 flex flex-col">
                        {selectedDoctor ? (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-lg font-semibold">{selectedDoctor.name}</h3>
                                    <p className="text-sm text-slate-500">
                                        Sprechen Sie den Namen so aus, wie Sie ihn normalerweise im Befehl verwenden würden.
                                    </p>
                                </div>

                                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl bg-slate-50 gap-4">
                                    <Button
                                        size="lg"
                                        variant={isRecording ? "destructive" : "secondary"}
                                        className={`w-16 h-16 rounded-full ${isRecording ? 'animate-pulse' : ''}`}
                                        onClick={isRecording ? stopRecording : startRecording}
                                        disabled={isProcessing}
                                    >
                                        {isProcessing ? <Loader2 className="w-8 h-8 animate-spin" /> : isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
                                    </Button>
                                    <div className="text-sm font-medium text-slate-600">
                                        {isProcessing ? "Verarbeite..." : isRecording ? "Sprechen Sie jetzt..." : "Klicken zum Aufnehmen"}
                                    </div>
                                </div>

                                <div className="flex items-center justify-center gap-2 mt-2">
                                    <input 
                                        type="checkbox" 
                                        id="useElevenLabs"
                                        checked={useElevenLabs}
                                        onChange={(e) => setUseElevenLabs(e.target.checked)}
                                        className="rounded border-slate-300"
                                    />
                                    <label htmlFor="useElevenLabs" className="text-xs text-slate-500 cursor-pointer select-none">
                                        High-Quality (ElevenLabs) verwenden
                                    </label>
                                </div>

                                {detectedText && (
                                    <div className="bg-white p-4 rounded-lg border shadow-sm space-y-3">
                                        <div className="text-xs text-slate-500 uppercase font-bold">Erkannt</div>
                                        <div className="text-lg font-medium text-slate-900">"{detectedText}"</div>
                                        <div className="flex gap-2 pt-2">
                                            <Button onClick={handleSave} className="w-full">
                                                <Plus className="w-4 h-4 mr-2" />
                                                Als Alias speichern
                                            </Button>
                                            <Button variant="outline" onClick={() => setDetectedText("")}>Verwerfen</Button>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="font-medium mb-2 text-sm text-slate-500">Gespeicherte Aliases</div>
                                    <div className="space-y-2">
                                        {aliases.filter(a => a.doctor_id === selectedDoctor.id).map(alias => (
                                            <div key={alias.id} className="flex items-center justify-between p-2 bg-slate-50 rounded border">
                                                <span className="font-mono text-sm">"{alias.detected_text}"</span>
                                                <Button 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    className="h-6 w-6 text-slate-400 hover:text-red-600"
                                                    onClick={() => deleteAliasMutation.mutate(alias.id)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                        {aliases.filter(a => a.doctor_id === selectedDoctor.id).length === 0 && (
                                            <div className="text-sm text-slate-400 italic">Keine Aliases gespeichert</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400">
                                Wählen Sie einen Arzt aus der Liste
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}