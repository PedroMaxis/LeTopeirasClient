import type { MouseEvent } from 'react';
import { settings } from '../lib/settings';
import { useSession } from '../state/session';
import { INSERT_MENTION_EVENT, useMemberCard } from './MemberCard';
import { useContextMenu } from './ui/ContextMenu';
import { VolumeControls } from './voice/VolumeControls';

/**
 * Right-click menu for a person (member list, message author, voice member, stage tile):
 * Perfil, Marcar and, when we can hear them, their volume and Silenciar. Render `menu`.
 */
export function usePersonMenu() {
  const { chat, voice } = useSession();
  const context = useContextMenu();
  const card = useMemberCard();

  /** `inVoice`: shown where they are in a voice room (sidebar, stage), so volume applies. */
  const open =
    (userId: number, { inVoice = false } = {}) =>
    (event: MouseEvent) => {
      const { users, me } = chat.store.get();
      const user = users[userId];
      if (!user) return;
      const isMe = user.id === me?.id;
      const hearable = inVoice || voice.state.room?.remoteParticipants.has(String(userId));
      const volume = settings.get().userVolumes[String(userId)] ?? 100;
      const at = new DOMRect(event.clientX, event.clientY, 0, 0);
      context.open(event, [
        { title: user.displayName },
        { label: 'Perfil', onSelect: () => card.openAt(userId, at) },
        !isMe && {
          label: `Marcar @${user.username}`,
          onSelect: () =>
            window.dispatchEvent(new CustomEvent(INSERT_MENTION_EVENT, { detail: user.username })),
        },
        !isMe && hearable && { separator: true },
        !isMe &&
          hearable && {
            label: volume === 0 ? 'Desfazer silêncio' : 'Silenciar',
            onSelect: () => voice.setUserVolume(userId, volume === 0 ? 100 : 0),
          },
        !isMe && hearable && { key: 'volume', render: () => <VolumeControls userId={userId} /> },
      ]);
    };

  return {
    open,
    menu: (
      <>
        {context.menu}
        {card.card}
      </>
    ),
  };
}
