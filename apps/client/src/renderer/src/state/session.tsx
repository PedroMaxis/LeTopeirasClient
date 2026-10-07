import { createContext, useContext } from 'react';
import { Api } from '../lib/api';
import { ChatClient } from './chat';
import { VoiceClient } from './voice';

const IDLE_AFTER_SECONDS = 10 * 60;
const IDLE_POLL_MS = 20_000;

/** Everything that exists while logged in. Created at login, disposed at logout. */
export class Session {
  readonly api: Api;
  readonly chat: ChatClient;
  readonly voice: VoiceClient;
  private disposed = false;
  private readonly idleTimer: ReturnType<typeof setInterval>;
  private idle = false;

  constructor(
    readonly token: string,
    private readonly onEnded: (reason: string | null) => void,
  ) {
    const expired = () => this.end('Sua sessão expirou. Entre de novo.');
    this.api = new Api(token, expired);
    this.chat = new ChatClient(token, this.api, expired);
    this.voice = new VoiceClient(this.api, (muted, deafened) =>
      this.chat.reportVoiceState(muted, deafened),
    );

    // After a gateway reconnect the server may have restarted and forgotten our mute state.
    let lastStatus = this.chat.store.get().status;
    this.chat.store.subscribe(() => {
      const { status } = this.chat.store.get();
      if (status === 'ready' && lastStatus !== 'ready' && this.voice.state.room) {
        this.chat.reportVoiceState(this.voice.state.muted, this.voice.state.deafened);
      }
      if (status === 'ready' && lastStatus !== 'ready' && this.idle) {
        this.chat.reportPresence('idle');
      }
      lastStatus = status;
    });

    // "Ausente" after 10 minutes without keyboard or mouse input anywhere on the PC.
    this.idleTimer = setInterval(() => void this.checkIdle(), IDLE_POLL_MS);
  }

  private async checkIdle(): Promise<void> {
    const idle = (await window.api.getIdleSeconds().catch(() => 0)) >= IDLE_AFTER_SECONDS;
    if (idle === this.idle || this.disposed) return;
    this.idle = idle;
    this.chat.reportPresence(idle ? 'idle' : 'online');
  }

  async logout(): Promise<void> {
    await this.api.logout().catch(() => undefined);
    this.end(null);
  }

  private end(reason: string | null): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.idleTimer);
    this.voice.dispose();
    this.chat.close();
    void window.api.clearSession();
    this.onEnded(reason);
  }
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside of SessionContext');
  return session;
}
