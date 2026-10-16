import { useState } from 'react';
import type { User } from '@letopeiras/shared';
import { fileUrl } from '../../lib/attachments';

// Avatar backgrounds from the mockups; white initials read well on all of them.
const COLORS = [
  '#a8481f',
  '#2a64a3',
  '#7a3fb0',
  '#1f7356',
  '#a3305f',
  '#5d6420',
  '#6a4b2a',
  '#3c5a8a',
];

export const avatarColor = (userId: number) => COLORS[userId % COLORS.length];

interface Props {
  user: Pick<User, 'id' | 'displayName' | 'avatarUrl'> | undefined;
  size: number;
  speaking?: boolean;
  /** Presence dot in the corner. */
  status?: 'online' | 'idle' | 'offline' | undefined;
}

export function Avatar({ user, size, speaking = false, status }: Props) {
  const initial = user?.displayName.trim().charAt(0).toUpperCase() || '?';
  const style = { width: size, height: size };
  // A photo that fails to load (offline, file gone) falls back to the initials.
  const [broken, setBroken] = useState<string | null>(null);
  const photo = user?.avatarUrl && user.avatarUrl !== broken ? user.avatarUrl : null;
  return (
    <span className="avatar-wrap" style={style}>
      {photo ? (
        <img
          className={`avatar avatar-photo ${speaking ? 'speaking' : ''}`}
          src={fileUrl(photo)}
          alt=""
          draggable={false}
          style={style}
          onError={() => setBroken(photo)}
        />
      ) : (
        <span
          className={`avatar ${speaking ? 'speaking' : ''}`}
          style={{
            ...style,
            fontSize: Math.round(size * 0.4),
            background: user ? avatarColor(user.id) : 'var(--bg-input)',
          }}
        >
          {initial}
        </span>
      )}
      {status && <span className={`presence-dot ${status}`} />}
    </span>
  );
}
