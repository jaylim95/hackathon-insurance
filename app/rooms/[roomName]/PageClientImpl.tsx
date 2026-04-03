'use client';

import React from 'react';
import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { Room, RoomConnectOptions, RoomEvent, RoomOptions } from 'livekit-client';
import { useRouter } from 'next/navigation';
import { createSipCall, hangupSipCall } from '@/lib/sip_call';
import { ConnectionDetails } from '@/lib/types';
import { useTranscription } from '@/lib/useTranscription';
import styles from '@/styles/Dialer.module.css';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';

const PROMPT_CARDS = [
  {
    id: 'recording-consent',
    badge: '🔵 Info',
    title: 'Recording consent request',
    whyItMatters:
      "Adjusters ask for recording consent immediately — before you're even in the conversation. A recorded statement can be used against you. You are not legally required to agree.",
    sayThis: '“I prefer not to be recorded. Please communicate with me in writing.”',
  },
  {
    id: 'feeling-okay',
    badge: '🔴 Red flag',
    title: 'Adjuster asks how you are feeling',
    whyItMatters:
      "Saying 'okay' or 'fine' becomes evidence. The adjuster will use this to argue your injuries weren't serious — even if symptoms haven't fully appeared yet.",
    sayThis: '“I am still treating and not in a position to discuss my condition.”',
  },
  {
    id: 'walk-back',
    badge: '🟡 Recovery',
    title: 'You corrected the record',
    whyItMatters:
      "Good correction. You've walked back the statement and reestablished that you are still treating. The adjuster may try to use the initial 'okay' anyway — stay consistent from here.",
    sayThis:
      '“I mean okay only in the sense that I am coping. I am still receiving treatment and waiting on results from my medical team.”',
  },
  {
    id: 'lowball-offer',
    badge: '🔴 Red flag',
    title: 'Early settlement push',
    whyItMatters:
      "They've ignored your correction and are pressing forward with the lowball offer anyway. 'Staying positive' is now their framing. Do not engage with the number.",
    sayThis:
      '“I am not in a position to discuss settlement. Please send any correspondence in writing.”',
  },
] as const;

type CallStatus = 'connecting' | 'ready' | 'dialing' | 'in-call' | 'call-ended' | 'error';

export function PageClientImpl(props: {
  roomName: string;
  participantName?: string;
  initialPhoneNumber?: string;
  initialSipTrunkId?: string;
  autoDial: boolean;
}) {
  const router = useRouter();
  const [participantName] = React.useState(props.participantName?.trim() || 'Caller');
  const [phoneNumber, setPhoneNumber] = React.useState(props.initialPhoneNumber?.trim() || '');
  const [sipTrunkId, setSipTrunkId] = React.useState(props.initialSipTrunkId?.trim() || '');
  const [secondsElapsed, setSecondsElapsed] = React.useState(0);
  const [currentCardIndex, setCurrentCardIndex] = React.useState(-1);
  const [status, setStatus] = React.useState<CallStatus>('connecting');
  const [error, setError] = React.useState('');
  const [sipParticipantIdentity, setSipParticipantIdentity] = React.useState<string | null>(null);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | null>(null);
  const roomOptions = React.useMemo<RoomOptions>(
    () => ({
      adaptiveStream: true,
      dynacast: true,
    }),
    [],
  );
  const room = React.useMemo(() => new Room(roomOptions), [roomOptions]);
  const connectOptions = React.useMemo<RoomConnectOptions>(() => ({ autoSubscribe: true }), []);
  const { transcripts, isConnected: transcriptionConnected } = useTranscription({
    room,
    enabled: status === 'in-call',
  });
  const transcriptEndRef = React.useRef<HTMLDivElement>(null);
  const autoDialStartedRef = React.useRef(false);
  const sipParticipantIdentityRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSecondsElapsed((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  React.useEffect(() => {
    sipParticipantIdentityRef.current = sipParticipantIdentity;
  }, [sipParticipantIdentity]);

  const dialPhone = React.useCallback(async () => {
    const trimmedPhoneNumber = phoneNumber.trim();
    if (!trimmedPhoneNumber) {
      setError('Enter a phone number to place a call.');
      return;
    }

    setError('');
    setStatus('dialing');

    try {
      const result = await createSipCall(props.roomName, trimmedPhoneNumber, sipTrunkId || undefined);
      setSipParticipantIdentity(result.participantIdentity);
      setStatus('in-call');
    } catch (callError) {
      setStatus('ready');
      setError(callError instanceof Error ? callError.message : 'Failed to place the call.');
    }
  }, [phoneNumber, props.roomName, sipTrunkId]);

  const hangupPhone = React.useCallback(async () => {
    if (!sipParticipantIdentity) {
      return;
    }

    setError('');
    setStatus('dialing');

    try {
      await hangupSipCall(props.roomName, sipParticipantIdentity);
      setSipParticipantIdentity(null);
      setStatus('call-ended');
    } catch (callError) {
      setStatus('in-call');
      setError(callError instanceof Error ? callError.message : 'Failed to hang up the call.');
    }
  }, [props.roomName, sipParticipantIdentity]);

  React.useEffect(() => {
    let cancelled = false;

    const connectRoom = async () => {
      setStatus('connecting');
      setError('');

      try {
        const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
        url.searchParams.set('roomName', props.roomName);
        url.searchParams.set('participantName', participantName);

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const details = (await response.json()) as ConnectionDetails;
        if (cancelled) {
          return;
        }

        setConnectionDetails(details);
        await room.connect(details.serverUrl, details.participantToken, connectOptions);
        await room.localParticipant.setMicrophoneEnabled(true);

        if (!cancelled) {
          setStatus('ready');
        }
      } catch (connectError) {
        if (!cancelled) {
          setStatus('error');
          setError(connectError instanceof Error ? connectError.message : 'Failed to connect.');
        }
      }
    };

    const handleParticipantDisconnected = (participant: { identity: string }) => {
      if (participant.identity === sipParticipantIdentityRef.current) {
        setSipParticipantIdentity(null);
        setStatus('call-ended');
      }
    };

    const handleDisconnected = () => {
      router.push('/');
    };

    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);

    void connectRoom();

    return () => {
      cancelled = true;
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.disconnect();
    };
  }, [connectOptions, participantName, props.roomName, room, router]);

  React.useEffect(() => {
    if (
      status === 'ready' &&
      props.autoDial &&
      phoneNumber.trim() &&
      !sipParticipantIdentity &&
      !autoDialStartedRef.current
    ) {
      autoDialStartedRef.current = true;
      void dialPhone();
    }
  }, [dialPhone, phoneNumber, props.autoDial, sipParticipantIdentity, status]);

  React.useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();

      setCurrentCardIndex((current) => {
        if (current >= PROMPT_CARDS.length - 1) {
          return current;
        }
        return current + 1;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const leaveRoom = async () => {
    if (sipParticipantIdentityRef.current) {
      try {
        await hangupSipCall(props.roomName, sipParticipantIdentityRef.current);
      } catch (callError) {
        setError(callError instanceof Error ? callError.message : 'Failed to end the active call.');
        return;
      }
    }

    room.disconnect();
    router.push('/');
  };

  const surfacedCount = Math.max(0, currentCardIndex + 1);
  const surfacedCards = PROMPT_CARDS.slice(0, surfacedCount).reverse();

  return (
    <main className={styles.assistantPage}>
      <RoomContext.Provider value={room}>
        <RoomAudioRenderer />

        <section className={styles.assistantShell}>
          <header className={styles.statusBar}>
            <div className={styles.statusTopRow}>
              <div className={styles.livePill}>
                <span className={styles.liveDot} />
                LIVE
              </div>
              <span className={styles.statusDivider} />
              <span className={styles.statusLabel}>Car Accident</span>
              <span className={styles.statusDivider} />
              <span className={styles.statusLabel}>{formatDuration(secondsElapsed)}</span>
            </div>
            <div className={styles.statusMetaRow}>
              <p className={styles.statusSummary}>{surfacedCount} red flags surfaced</p>
              <div className={styles.statusMetaDetails}>
                <span className={styles.statusDetail}>{statusLabel(status)}</span>
              </div>
            </div>
          </header>

          <div className={styles.assistantGrid}>
            <section className={styles.callPanel}>
              <div className={styles.promptHeader}>
                <p className={styles.sectionEyebrow}>Call Panel</p>
                <p className={styles.helperCopy}>
                  The call is live. The assistant is listening in the background.
                </p>
              </div>

              <div className={styles.liveControls}>
                <div className={styles.callMetrics}>
                  <Metric label="Call status" value={statusLabel(status)} />
                  <Metric label="Elapsed" value={formatDuration(secondsElapsed)} />
                  <Metric label="Red flags" value={String(surfacedCount)} />
                </div>

                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="phone-number">
                    Outbound phone number
                  </label>
                  <input
                    className={styles.input}
                    id="phone-number"
                    type="tel"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                    placeholder="+14155550123"
                    disabled={status === 'connecting' || status === 'dialing' || !!sipParticipantIdentity}
                  />
                </div>

                <div className={styles.fieldGroup} hidden aria-hidden="true" style={{ display: 'none' }}>
                  <label className={styles.label} htmlFor="sip-trunk-id">
                    SIP trunk ID
                  </label>
                  <input
                    className={styles.input}
                    id="sip-trunk-id"
                    type="text"
                    value={sipTrunkId}
                    onChange={(event) => setSipTrunkId(event.target.value)}
                    placeholder="Optional if SIP_TRUNK_ID is set"
                    disabled={status === 'dialing' || !!sipParticipantIdentity}
                  />
                </div>

                {error ? <p className={styles.error}>{error}</p> : null}

                <div className={styles.actions}>
                  {sipParticipantIdentity ? (
                    <button type="button" className={styles.dangerButton} onClick={() => void hangupPhone()}>
                      Hang up
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void dialPhone()}
                      disabled={status !== 'ready' && status !== 'call-ended'}
                    >
                      {status === 'dialing' ? 'Calling...' : 'Call now'}
                    </button>
                  )}

                  <button type="button" className={styles.secondaryButton} onClick={() => void leaveRoom()}>
                    End session
                  </button>
                </div>
              </div>

              {status === 'in-call' || transcripts.length > 0 ? (
                <div className={styles.transcriptSection}>
                  <div className={styles.transcriptHeader}>
                    <p className={styles.sectionEyebrow}>Live Transcript</p>
                    {transcriptionConnected && (
                      <span className={styles.transcriptLive}>
                        <span className={styles.liveDot} />
                        Listening
                      </span>
                    )}
                  </div>
                  <div className={styles.transcriptScroll}>
                    {transcripts.map((entry, i) => (
                      <div
                        key={i}
                        className={`${styles.transcriptEntry} ${!entry.isFinal ? styles.transcriptPartial : ''}`}
                      >
                        <span className={styles.transcriptSpeaker}>{entry.speaker}</span>
                        <span className={styles.transcriptText}>{entry.text}</span>
                      </div>
                    ))}
                    <div ref={transcriptEndRef} />
                  </div>
                </div>
              ) : null}
            </section>

            <section className={styles.promptPanel}>
              <div className={styles.promptHeader}>
                <p className={styles.sectionEyebrow}>Assistant Feed</p>
                <p className={styles.helperCopy}>
                  New cards appear at top.
                </p>
              </div>

              {surfacedCards.length > 0 ? (
                <div className={styles.promptStack}>
                  {surfacedCards.map((card, index) => (
                    <article
                      key={card.id}
                      className={`${styles.promptCard} ${index === 0 ? styles.promptCardNewest : ''}`}
                    >
                      <p className={styles.redFlagLabel}>{card.badge}</p>
                      <p className={styles.promptCardTitle}>{card.title}</p>
                      <p className={styles.promptBody}>{card.whyItMatters}</p>
                      <div className={styles.promptDivider} />
                      <div className={styles.sayThisBlock}>
                        <p className={styles.sayThisLabel}>Say this</p>
                        <p className={styles.sayThisQuote}>{card.sayThis}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.promptPlaceholder}>
                  <p className={styles.promptPlaceholderTitle}>Waiting for the first coaching card</p>
                  <p className={styles.promptPlaceholderCopy}>
                    Start the call on the left. When the insurer says something important, new cards appear automatically.
                  
                  </p>
                </div>
              )}
            </section>
          </div>
        </section>
      </RoomContext.Provider>
    </main>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function statusLabel(status: CallStatus) {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'ready':
      return 'Ready';
    case 'dialing':
      return 'Dialing';
    case 'in-call':
      return 'Call live';
    case 'call-ended':
      return 'Call ended';
    case 'error':
      return 'Error';
  }
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className={styles.metricCard}>
      <p className={styles.metricLabel}>{props.label}</p>
      <p className={styles.metricValue}>{props.value}</p>
    </div>
  );
}
