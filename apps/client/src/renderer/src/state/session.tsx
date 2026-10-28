import { createContext, useContext } from 'react';
import { Api } from '../lib/api';
import { canAccess } from '../lib/roles';
import { syncTaskbarBadge } from '../lib/taskbar';
import { showToast } from '../lib/toast';
import { ChatClient } from './chat';
import { MusicClient } from './music';
import { VoiceClient } from './voice';

const IDLE_AFTER_SECONDS = 10 * 60;
const IDLE_POLL_MS = 20_000;

/** Everything that exists while logged in. Created at login, disposed at logout. */
export class Session {
  readonly api: Api;
  readonly chat: ChatClient;
  readonly voice: VoiceClient;
  readonly music: MusicClient;
  private disposed = false;
  private readonly idleTimer: ReturnType<typeof setInterval>;
  private readonly stopTaskbarBadge: () => void;
  private idle = false;
  private resumeChecked = false;

  constructor(
    readonly token: string,
    private readonly onEnded: (reason: string | null) => void,
  ) {
    const expired = () => this.end('Sua sessão expirou. Entre de novo.');
    this.api = new Api(token, expired);
    this.chat = new ChatClient(token, this.api, expired);
    this.voice = new VoiceClient(this.api, (muted, deafened, watching) =>
      this.chat.reportVoiceState(muted, deafened, watching),
    );

    this.music = new MusicClient(this.api, this.chat, this.voice);

    // After a gateway reconnect the server may have restarted and forgotten our mute state.
    let lastStatus = this.chat.store.get().status;
    this.chat.store.subscribe(() => {
      const { status } = this.chat.store.get();
      if (status === 'ready' && lastStatus !== 'ready' && this.voice.state.room) {
        this.voice.forceReport();
      }
      if (status === 'ready' && lastStatus !== 'ready' && this.idle) {
        this.chat.reportPresence('idle');
      }
      if (status === 'ready' && !this.resumeChecked) {
        this.resumeChecked = true;
        void this.resumeVoice();
      }
      lastStatus = status;
    });

    // Unread mentions on the taskbar button.
    this.stopTaskbarBadge = syncTaskbarBadge(this.chat.store);

    // "Ausente" after 10 minutes without keyboard or mouse input anywhere on the PC.
    this.idleTimer = setInterval(() => void this.checkIdle(), IDLE_POLL_MS);
  }

  /** After main reloaded this page from a crash: back into the voice room we were in. */
  private async resumeVoice(): Promise<void> {
    const resume = await window.api.takeVoiceResume().catch(() => null);
    if (!resume || this.disposed || this.voice.state.channelId !== null) return;
    const { channels, me } = this.chat.store.get();
    const channel = channels.find((c) => c.id === resume.channelId);
    if (channel?.type !== 'voice' || !canAccess(me, channel)) return;
    if (!(await this.voice.rejoin(channel.id, resume.muted, resume.deafened))) return;
    showToast(
      resume.sharing
        ? 'Você voltou para a call depois de um erro. Transmissão e câmera ficaram desligadas.'
        : 'Você voltou para a call depois de um erro.',
      'info',
    );
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
    this.stopTaskbarBadge();
    this.music.dispose();
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
