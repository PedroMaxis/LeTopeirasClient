import type { VoiceChannelState } from '@letopeiras/shared';

interface Presence {
  screenSharing: boolean;
}

/**
 * In-memory view of who is in which voice channel, fed by LiveKit webhooks plus the
 * mute/deafen state that clients report over the WebSocket. Mutators return the ids of
 * channels whose state changed, so callers know what to broadcast.
 */
export class VoiceStateStore {
  private readonly channels = new Map<number, Map<number, Presence>>();
  private readonly selfState = new Map<number, { muted: boolean; deafened: boolean }>();

  join(channelId: number, userId: number): number[] {
    const members = this.members(channelId);
    if (members.has(userId)) return [];
    members.set(userId, { screenSharing: false });
    return [channelId];
  }

  leave(channelId: number, userId: number): number[] {
    const members = this.channels.get(channelId);
    if (!members?.delete(userId)) return [];
    if (members.size === 0) this.channels.delete(channelId);
    return [channelId];
  }

  setScreenSharing(channelId: number, userId: number, screenSharing: boolean): number[] {
    // A track event can arrive before participant_joined; treat it as a join.
    const members = this.members(channelId);
    const presence = members.get(userId);
    if (presence?.screenSharing === screenSharing) return [];
    members.set(userId, { screenSharing });
    return [channelId];
  }

  clearChannel(channelId: number): number[] {
    return this.channels.delete(channelId) ? [channelId] : [];
  }

  setSelfState(userId: number, muted: boolean, deafened: boolean): number[] {
    const prev = this.selfState.get(userId);
    if (prev?.muted === muted && prev.deafened === deafened) return [];
    this.selfState.set(userId, { muted, deafened });
    return [...this.channels].filter(([, m]) => m.has(userId)).map(([id]) => id);
  }

  /** Replaces everything (used when resyncing from the LiveKit API). Returns all touched ids. */
  replaceAll(snapshot: Map<number, Map<number, Presence>>): number[] {
    const touched = new Set([...this.channels.keys(), ...snapshot.keys()]);
    this.channels.clear();
    for (const [channelId, members] of snapshot)
      if (members.size) this.channels.set(channelId, members);
    return [...touched];
  }

  get(channelId: number): VoiceChannelState {
    const members = this.channels.get(channelId) ?? new Map<number, Presence>();
    return {
      channelId,
      participants: [...members].map(([userId, presence]) => ({
        userId,
        muted: this.selfState.get(userId)?.muted ?? false,
        deafened: this.selfState.get(userId)?.deafened ?? false,
        screenSharing: presence.screenSharing,
      })),
    };
  }

  all(): VoiceChannelState[] {
    return [...this.channels.keys()].map((id) => this.get(id));
  }

  private members(channelId: number): Map<number, Presence> {
    let members = this.channels.get(channelId);
    if (!members) {
      members = new Map();
      this.channels.set(channelId, members);
    }
    return members;
  }
}
