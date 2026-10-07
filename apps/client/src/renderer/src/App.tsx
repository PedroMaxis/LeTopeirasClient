import { useCallback, useEffect, useState } from 'react';
import type { AuthResponse } from '@letopeiras/shared';
import { AuthScreen } from './components/AuthScreen';
import { DebugPanel } from './components/DebugPanel';
import { MainLayout } from './components/MainLayout';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { useStore } from './lib/store';
import { Session, SessionContext } from './state/session';

type Phase =
  { kind: 'loading' } | { kind: 'auth'; notice: string | null } | { kind: 'in'; session: Session };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [debugOpen, setDebugOpen] = useState(false);

  const start = useCallback((token: string) => {
    const session = new Session(token, (reason) => setPhase({ kind: 'auth', notice: reason }));
    setPhase({ kind: 'in', session });
  }, []);

  // Resume the session saved with "Manter conectado"; an expired token ends up on the
  // login screen through the gateway's unauthorized close.
  useEffect(() => {
    let cancelled = false;
    void window.api
      .loadSession()
      .catch(() => null)
      .then((token) => {
        if (cancelled) return;
        if (token) start(token);
        else setPhase({ kind: 'auth', notice: null });
      });
    return () => {
      cancelled = true;
    };
  }, [start]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        setDebugOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onAuthenticated = (auth: AuthResponse, remember: boolean) => {
    if (remember) void window.api.saveSession(auth.token);
    start(auth.token);
  };

  return (
    <div className="app">
      <TitleBar />
      {phase.kind === 'auth' && (
        <AuthScreen notice={phase.notice} onAuthenticated={onAuthenticated} />
      )}
      {phase.kind === 'in' && (
        <SessionContext.Provider value={phase.session}>
          <MainLayout />
          {debugOpen && (
            <SessionDebugPanel session={phase.session} onClose={() => setDebugOpen(false)} />
          )}
        </SessionContext.Provider>
      )}
      {phase.kind !== 'in' && debugOpen && (
        <DebugPanel room={null} onClose={() => setDebugOpen(false)} />
      )}
      <Toasts />
    </div>
  );
}

function SessionDebugPanel({ session, onClose }: { session: Session; onClose(): void }) {
  const room = useStore(session.voice.store, (s) => s.room);
  return <DebugPanel room={room} onClose={onClose} />;
}
