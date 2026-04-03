'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, type RemoteTrackPublication, type Room } from 'livekit-client';

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

const WORKLET_CODE = `
class Pcm16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const float32 = input[0];
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
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
      // 1. Get temporary token
      const tokenRes = await fetch('/api/assemblyai-token', { method: 'POST' });
      if (!tokenRes.ok || cancelled) return;
      const { token } = await tokenRes.json();

      // 2. Open WebSocket to AssemblyAI
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?speech_model=u3-rt-pro&sample_rate=16000&token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'Turn' && msg.transcript) {
          const entry: TranscriptEntry = {
            speaker: msg.speaker ?? 'Speaker',
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

      ws.onerror = () => setIsConnected(false);
      ws.onclose = () => setIsConnected(false);

      // 3. Set up audio: mix all room audio (local mic + remote participants) into one stream
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

      workletNode.port.onmessage = (e: MessageEvent) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(e.data as ArrayBuffer);
        }
      };

      mixer.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Helper to connect any audio track's MediaStream to the mixer
      const connectTrack = (id: string, mediaStream: MediaStream) => {
        const existing = sourcesRef.current.get(id);
        if (existing) existing.disconnect();
        const source = audioContext.createMediaStreamSource(mediaStream);
        sourcesRef.current.set(id, source);
        source.connect(mixer);
      };

      // Connect local mic
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track?.mediaStream) {
        connectTrack('local-mic', micPub.track.mediaStream);
      }

      // Connect all existing remote audio tracks
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
          if (pub.isSubscribed && pub.track?.mediaStream && pub.track.source === Track.Source.Microphone) {
            connectTrack(`remote-${participant.identity}`, pub.track.mediaStream);
          }
        }
      }

      // Listen for new remote audio tracks
      const onTrackSubscribed = (_track: unknown, publication: RemoteTrackPublication) => {
        if (publication.track?.source === Track.Source.Microphone && publication.track.mediaStream) {
          connectTrack(`remote-${publication.track.sid}`, publication.track.mediaStream);
        }
      };
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

      // Store for cleanup
      return () => {
        room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      };
    };

    let removeListener: (() => void) | undefined;
    void start().then((fn) => { removeListener = fn; });

    return () => {
      cancelled = true;
      removeListener?.();
      cleanup();
    };
  }, [enabled, room, cleanup]);

  return { transcripts, isConnected, cleanup };
}
