'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { generateRoomId } from '@/lib/client-utils';
import dialerStyles from '../styles/Dialer.module.css';

export default function Page() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = React.useState('');

  const startLiveCall = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const params = new URLSearchParams({
      name: 'Caller',
      phone: phoneNumber.trim(),
      autodial: 'true',
    });

    router.push(`/rooms/${generateRoomId()}?${params.toString()}`);
  };

  return (
    <>
      <main className={dialerStyles.page} data-lk-theme="default">
        <div className={dialerStyles.panel}>
          <div className={dialerStyles.header}>
            <p className={dialerStyles.eyebrow} hidden>
              demo
            </p>
            <h1 className={dialerStyles.title}>Live Call Assistant</h1>
            <p className={dialerStyles.description}>
              Place a real outbound call through the platform.
            </p>
          </div>

          <form className={dialerStyles.form} onSubmit={startLiveCall}>
            <div className={dialerStyles.scriptBlock}>
              <p className={dialerStyles.sectionEyebrow}>Call setup</p>
              <div className={dialerStyles.fieldGroup}>
                <label className={dialerStyles.label} htmlFor="phone-number">
                  Outbound phone number
                </label>
                <input
                  className={dialerStyles.input}
                  id="phone-number"
                  type="tel"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="+14155550123"
                  required
                />
              </div>
            </div>

            <div className={dialerStyles.scriptBlock}>
              <p className={dialerStyles.sectionEyebrow}>Live demo controls</p>
              <p className={dialerStyles.scriptLine}>The call starts automatically after connect.</p>
              <p className={dialerStyles.scriptLine}>
              </p>
              <p className={dialerStyles.scriptLine}>
                Cards cover injury questions, early settlement offers, and urgency pressure.
              </p>
            </div>

            <div className={dialerStyles.actions}>
              <button
                className={dialerStyles.primaryButton}
                type="submit"
                disabled={!phoneNumber.trim()}
              >
                Start live call
              </button>
            </div>
          </form>
        </div>
      </main>
      <footer data-lk-theme="default">
        Powered by{' '}
        <a href="https://seavoice.ai" rel="noopener">
          Seavoice AI
        </a>
      </footer>
    </>
  );
}
