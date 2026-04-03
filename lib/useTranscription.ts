'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, type RemoteTrackPublication, type Room } from 'livekit-client';
import { getAssemblyToken } from './getAssemblyToken';

export interface TranscriptEntry {
  speaker: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

interface UseTranscriptionOptions {
  room: Room;
  enabled: boolean;
}

// Buffer ~100ms of audio at 16kHz = 1600 samples before sending
const WORKLET_CODE = `
class Pcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1600);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const float32 = input[0];
      for (let i = 0; i < float32.length; i++) {
        this.buffer[this.offset++] = float32[i];
        if (this.offset >= 1600) {
          const int16 = new Int16Array(1600);
          for (let j = 0; j < 1600; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16-processor', Pcm16Processor);
`;

export function useTranscription({ room, enabled }: UseTranscriptionOptions) {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mixerRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'Terminate' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    for (const source of sourcesRef.current.values()) {
      source.disconnect();
    }
    sourcesRef.current.clear();
    if (mixerRef.current) {
      mixerRef.current.disconnect();
      mixerRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    let cancelled = false;

    const start = async () => {
      // 1. Get temporary token via server action
      console.log('[transcription] Getting token...');
      const result = await getAssemblyToken();
      if (cancelled) return;
      if ('error' in result) {
        console.error('[transcription] Token error:', result.error);
        return;
      }
      const { token } = result;
      console.log('[transcription] Got token, connecting WebSocket...');

      // 2. Open WebSocket to AssemblyAI
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?speech_model=u3-rt-pro&sample_rate=16000&speaker_labels=true&token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        console.log('[transcription] WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log('[transcription] Message:', msg.type, msg);

        if (msg.type === 'Turn' && msg.transcript) {
          const entry: TranscriptEntry = {
            speaker: msg.speaker_label ? `Speaker ${msg.speaker_label}` : 'Speaker',
            text: msg.transcript,
            isFinal: msg.end_of_turn === true,
            timestamp: Date.now(),
          };

          setTranscripts((prev) => {
            if (!entry.isFinal && prev.length > 0 && !prev[prev.length - 1].isFinal) {
              return [...prev.slice(0, -1), entry];
            }
            return [...prev, entry];
          });
        }
      };

      ws.onerror = (e) => {
        console.error('[transcription] WebSocket error:', e);
        setIsConnected(false);
      };

      ws.onclose = (e) => {
        console.log('[transcription] WebSocket closed:', e.code, e.reason);
        setIsConnected(false);
      };

      // Wait for WebSocket to open before setting up audio
      await new Promise<void>((resolve, reject) => {
        const origOpen = ws.onopen;
        const origError = ws.onerror;
        ws.onopen = (e) => {
          ws.onopen = origOpen;
          origOpen?.call(ws, e);
          resolve();
        };
        ws.onerror = (e) => {
          ws.onerror = origError;
          origError?.call(ws, e);
          reject(e);
        };
      });

      if (cancelled) return;

      // 3. Set up audio capture
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const workletBlob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(workletBlob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      if (cancelled) return;

      const mixer = audioContext.createGain();
      mixer.gain.value = 1;
      mixerRef.current = mixer;

      const workletNode = new AudioWorkletNode(audioContext, 'pcm16-processor');
      workletNodeRef.current = workletNode;

      let audioChunkCount = 0;
      workletNode.port.onmessage = (e: MessageEvent) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(e.data as ArrayBuffer);
          audioChunkCount++;
          if (audioChunkCount % 100 === 1) {
            console.log(`[transcription] Sent ${audioChunkCount} audio chunks`);
          }
        }
      };

      mixer.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Helper to connect a MediaStreamTrack to the mixer
      const connectMediaStreamTrack = (id: string, mediaStreamTrack: MediaStreamTrack) => {
        const existing = sourcesRef.current.get(id);
        if (existing) existing.disconnect();
        // Create a new MediaStream from the track
        const stream = new MediaStream([mediaStreamTrack]);
        const source = audioContext.createMediaStreamSource(stream);
        sourcesRef.current.set(id, source);
        source.connect(mixer);
        console.log(`[transcription] Connected audio source: ${id}`);
      };

      // Connect local mic — get the underlying MediaStreamTrack
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const micTrack = micPub?.track;
      console.log('[transcription] Local mic publication:', !!micPub, 'track:', !!micTrack);

      if (micTrack) {
        const mediaStreamTrack = micTrack.mediaStreamTrack;
        if (mediaStreamTrack) {
          connectMediaStreamTrack('local-mic', mediaStreamTrack);
        } else {
          console.warn('[transcription] No mediaStreamTrack on local mic');
        }
      }

      // Connect all existing remote audio tracks
      for (const participant of room.remoteParticipants.values()) {
        console.log(`[transcription] Remote participant: ${participant.identity}`);
        for (const pub of participant.trackPublications.values()) {
          const track = pub.track;
          if (track && track.source === Track.Source.Microphone && pub.isSubscribed) {
            const mst = track.mediaStreamTrack;
            if (mst) {
              connectMediaStreamTrack(`remote-${participant.identity}`, mst);
            }
          }
        }
      }

      // Listen for new remote audio tracks
      const onTrackSubscribed = (_track: unknown, publication: RemoteTrackPublication) => {
        const track = publication.track;
        if (track?.source === Track.Source.Microphone && track.mediaStreamTrack) {
          connectMediaStreamTrack(`remote-${track.sid}`, track.mediaStreamTrack);
        }
      };
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

      return () => {
        room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      };
    };

    let removeListener: (() => void) | undefined;
    void start().then((fn) => { removeListener = fn; }).catch((e) => {
      console.error('[transcription] Start failed:', e);
    });

    return () => {
      cancelled = true;
      removeListener?.();
      cleanup();
    };
  }, [enabled, room, cleanup]);

  return { transcripts, isConnected, cleanup };
}
