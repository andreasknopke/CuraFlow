import { useState, useEffect, useCallback, useRef } from 'react';

export function useElevenLabsConversation({ agentId, onMessage, onError, onConnect, onDisconnect, clientTools }) {
    const [status, setStatus] = useState('disconnected'); // disconnected, connecting, connected
    const [isSpeaking, setIsSpeaking] = useState(false);
    const socketRef = useRef(null);
    const clientToolsRef = useRef(clientTools);

    useEffect(() => {
        clientToolsRef.current = clientTools;
    }, [clientTools]);
    const audioContextRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const audioWorkletNodeRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);
    const nextStartTimeRef = useRef(0);
    const scheduledSourcesRef = useRef([]);

    // Initialize Audio Context
    useEffect(() => {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            audioContextRef.current = new AudioContext();
        }
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const playNextInQueue = useCallback(() => {
        if (!audioContextRef.current || audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            setIsSpeaking(false);
            return;
        }

        isPlayingRef.current = true;
        setIsSpeaking(true);

        const chunk = audioQueueRef.current.shift();
        const audioBuffer = chunk; 

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);

        const currentTime = audioContextRef.current.currentTime;
        // Schedule just after previous
        const startTime = Math.max(currentTime, nextStartTimeRef.current);
        
        source.start(startTime);
        scheduledSourcesRef.current.push(source);
        nextStartTimeRef.current = startTime + audioBuffer.duration;

        source.onended = () => {
             scheduledSourcesRef.current = scheduledSourcesRef.current.filter(s => s !== source);
             // Check if we have caught up
             if (audioContextRef.current.currentTime >= nextStartTimeRef.current) {
                 // Try to play next immediately or set playing to false
                 if (audioQueueRef.current.length === 0) {
                    isPlayingRef.current = false;
                    setIsSpeaking(false);
                 }
             }
        };
        
        // Chain playback
        playNextInQueue();

    }, []);

    const decodeAndQueueAudio = useCallback(async (base64Data) => {
        if (!audioContextRef.current) return;

        try {
            const binaryString = window.atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Try decoding as container format (MP3/WAV) first
            try {
                // We need to copy buffer because decodeAudioData detaches it
                const bufferCopy = bytes.buffer.slice(0);
                const audioBuffer = await audioContextRef.current.decodeAudioData(bufferCopy);
                audioQueueRef.current.push(audioBuffer);
                console.log("DEBUG: Audio Decoded (Native)", audioBuffer.duration, "seconds");
            } catch (decodeErr) {
                // If fail, assume Raw PCM 16bit 16kHz (Default for ElevenLabs ConvAI)
                // console.log("Decode failed, trying raw PCM...", decodeErr);
                
                const int16Data = new Int16Array(bytes.buffer);
                const float32Data = new Float32Array(int16Data.length);
                for (let i = 0; i < int16Data.length; i++) {
                    float32Data[i] = int16Data[i] / 32768.0;
                }
                
                const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 16000); // 16kHz default
                audioBuffer.copyToChannel(float32Data, 0);
                audioQueueRef.current.push(audioBuffer);
                console.log("DEBUG: Audio Decoded (PCM Fallback)", audioBuffer.duration, "seconds");
            }

            if (!isPlayingRef.current) {
                playNextInQueue();
            }
        } catch (err) {
            console.error("DEBUG: Audio processing error:", err);
        }
    }, [playNextInQueue]);

    const startConversation = useCallback(async (options = {}) => {
        const { dynamicVariables } = options;
        console.log("DEBUG: Starting conversation...", { agentId, status, dynamicVariables });
        if (!agentId) {
            const err = new Error("Agent ID is missing");
            console.error("DEBUG: Agent ID missing");
            onError && onError(err);
            return;
        }
        
        if (status === 'connected' || status === 'connecting') {
            console.log("DEBUG: Already connected/connecting");
            return;
        }

        try {
            setStatus('connecting');

            // 0. Resume Audio Context (browser requirement)
            if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            // 1. Get Microphone
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
            mediaStreamRef.current = stream;

            // 2. Connect WebSocket
            // Use secure websocket
            const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
            const ws = new WebSocket(wsUrl);
            socketRef.current = ws;

            ws.onopen = () => {
                console.log("DEBUG: ElevenLabs WS Connected");
                
                if (dynamicVariables) {
                    const initMsg = {
                        type: "conversation_initiation_client_data",
                        dynamic_variables: dynamicVariables
                    };
                    console.log("DEBUG: Sending dynamic variables", initMsg);
                    ws.send(JSON.stringify(initMsg));
                }

                setStatus('connected');
                onConnect && onConnect();
                
                // Start Audio Processing
                processMicrophone(stream, ws);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    console.log("DEBUG: Received WS Message", msg.type);
                    
                    if (msg.type === 'audio') {
                        // Handle different key names for audio data
                        const audioData = msg.audio_event?.audio_base_64 || msg.audio_event?.audio_base64_chunk;
                        
                        if (audioData) {
                            decodeAndQueueAudio(audioData);
                        } else {
                            console.warn("DEBUG: No audio data found in audio_event", msg.audio_event);
                        }
                    } else if (msg.type === 'interruption') {
                        // Stop all currently scheduled audio
                        scheduledSourcesRef.current.forEach(source => {
                            try { source.stop(); } catch (e) {}
                        });
                        scheduledSourcesRef.current = [];

                        // Clear queue
                        audioQueueRef.current = [];
                        nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
                        setIsSpeaking(false);
                    } else if (msg.type === 'ping') {
                         if (msg.ping_event?.event_id) {
                             ws.send(JSON.stringify({ type: "pong", event_id: msg.ping_event.event_id }));
                         }
                    } else if (msg.type === 'client_tool_call') {
                        const call = msg.client_tool_call;
                        if (call && clientToolsRef.current && clientToolsRef.current[call.tool_name]) {
                            console.log("Executing client tool:", call.tool_name);
                            Promise.resolve(clientToolsRef.current[call.tool_name](call.parameters))
                                .then(result => {
                                    // Ensure result is a string
                                    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                                    
                                    const responsePayload = {
                                        type: "client_tool_result",
                                        tool_call_id: call.tool_call_id,
                                        result: resultStr,
                                        is_error: false
                                    };
                                    
                                    console.log("Sending tool result:", responsePayload);
                                    ws.send(JSON.stringify(responsePayload));
                                })
                                .catch(err => {
                                    console.error("Client tool error", err);
                                    ws.send(JSON.stringify({
                                        type: "client_tool_result",
                                        tool_call_id: call.tool_call_id,
                                        result: JSON.stringify({ error: err.message }),
                                        is_error: true
                                    }));
                                });
                        }
                    }
                    
                    onMessage && onMessage(msg);
                } catch (e) {
                    console.error("WS Message Parse Error", e);
                }
            };

            ws.onerror = (e) => {
                console.error("DEBUG: ElevenLabs WS Error", e);
                onError && onError(e);
                setStatus('disconnected');
            };

            ws.onclose = (e) => {
                console.log("DEBUG: ElevenLabs WS Closed", e.code, e.reason);
                setStatus('disconnected');
                onDisconnect && onDisconnect();
                stopResources();
            };

        } catch (err) {
            console.error("Start Conversation Error", err);
            onError && onError(err);
            setStatus('disconnected');
            stopResources();
        }
    }, [agentId, decodeAndQueueAudio, onConnect, onDisconnect, onError, onMessage, status]);

    // Helper to downsample audio to 16kHz
    const downsampleTo16k = (buffer, sampleRate) => {
        if (sampleRate === 16000) return buffer;
        
        const ratio = sampleRate / 16000;
        const newLength = Math.ceil(buffer.length / ratio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        
        while (offsetResult < newLength) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
            // Use average value to prevent aliasing
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }
            result[offsetResult] = count > 0 ? accum / count : 0;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    };

    const processMicrophone = (stream, ws) => {
        if (!audioContextRef.current) return;
        
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            const sampleRate = audioContextRef.current.sampleRate;
            
            // Downsample to 16kHz if needed
            const downsampledData = downsampleTo16k(inputData, sampleRate);
            
            // Convert Float32 to Int16 (PCM)
            const pcmData = new Int16Array(downsampledData.length);
            for (let i = 0; i < downsampledData.length; i++) {
                let s = Math.max(-1, Math.min(1, downsampledData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Convert to Base64
            let binary = '';
            const bytes = new Uint8Array(pcmData.buffer);
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = window.btoa(binary);
            
            // Log first few chunks then occasionally
            if (!window.chunksSent) window.chunksSent = 0;
            window.chunksSent++;
            if (window.chunksSent < 5 || window.chunksSent % 50 === 0) {
                 console.log(`DEBUG: Sending audio chunk #${window.chunksSent} (Size: ${base64.length})`);
                 
                 // Check for silence (RMS)
                 let sum = 0;
                 for(let i=0; i<inputData.length; i++) {
                     sum += inputData[i] * inputData[i];
                 }
                 const rms = Math.sqrt(sum / inputData.length);
                 
                 console.log(`DEBUG: Input RMS: ${rms.toFixed(6)}`);
                 if (rms < 0.005) {
                     console.warn("DEBUG: Microphone input is very quiet.");
                 }
            }

            ws.send(JSON.stringify({
                user_audio_chunk: base64
            }));
        };

        source.connect(processor);
        processor.connect(audioContextRef.current.destination);
        
        const gain = audioContextRef.current.createGain();
        gain.gain.value = 0;
        processor.disconnect();
        processor.connect(gain);
        gain.connect(audioContextRef.current.destination);

        audioWorkletNodeRef.current = { source, processor, gain };
    };

    const stopResources = () => {
        // Stop all currently scheduled audio
        scheduledSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) {}
        });
        scheduledSourcesRef.current = [];

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (audioWorkletNodeRef.current) {
            const { source, processor, gain } = audioWorkletNodeRef.current;
            source.disconnect();
            processor.disconnect();
            gain.disconnect();
            audioWorkletNodeRef.current = null;
        }
        
        audioQueueRef.current = [];
        nextStartTimeRef.current = 0;
        setIsSpeaking(false);
        isPlayingRef.current = false;
    };

    const stopConversation = useCallback(() => {
        if (socketRef.current) {
            socketRef.current.close();
            socketRef.current = null;
        }
        stopResources();
        setStatus('disconnected');
    }, []);

    return {
        status,
        isSpeaking,
        startConversation,
        stopConversation
    };
}