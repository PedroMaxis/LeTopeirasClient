import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { LIMITS, type Channel } from '@letopeiras/shared';
import { useStore } from '../../lib/store';
import { useSession } from '../../state/session';
import { IconButton } from '../ui/controls';
import { EmojiPicker } from './EmojiPicker';
import { useMentionAutocomplete } from './MentionSuggestions';

export function Composer({ channel }: { channel: Channel }) {
  const { chat } = useSession();
  const [value, setValue] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionAutocomplete({ channel, value, setValue, input });

  /** Inserts at the cursor and keeps typing focus. */
  const insertEmoji = (emoji: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + emoji + value.slice(end)).slice(0, LIMITS.messageMax);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const send = () => {
    const content = value.trim();
    if (!content) return;
    chat.sendMessage(channel.id, content);
    setValue('');
    mentions.reset();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.onKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={input}
          className="composer-input"
          aria-label="Mensagem"
          placeholder={`Conversar em #${channel.name}`}
          value={value}
          autoFocus
          maxLength={LIMITS.messageMax}
          rows={Math.min(10, value.split('\n').length)}
          onChange={(e) => {
            setValue(e.target.value);
            mentions.trackCursor(e.target);
            if (e.target.value.trim()) chat.startTyping(channel.id);
          }}
          onSelect={(e) => mentions.trackCursor(e.currentTarget)}
          onKeyDown={onKeyDown}
        />
        {mentions.popover}
        <IconButton
          icon="smile"
          size={22}
          label="Emojis"
          className="composer-emoji"
          active={emojiOpen}
          onClick={() => setEmojiOpen((open) => !open)}
        />
        {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      </div>
      <TypingIndicator channelId={channel.id} />
    </div>
  );
}

function TypingIndicator({ channelId }: { channelId: number }) {
  const { chat } = useSession();
  const typing = useStore(chat.store, (s) => s.typing[channelId]);
  const users = useStore(chat.store, (s) => s.users);
  const meId = useStore(chat.store, (s) => s.me?.id);

  const names = Object.keys(typing ?? {})
    .map(Number)
    .filter((id) => id !== meId)
    .map((id) => users[id]?.displayName ?? 'Alguém');

  let text: ReactNode = null;
  if (names.length === 1) {
    text = (
      <>
        <b>{names[0]}</b> está digitando…
      </>
    );
  } else if (names.length === 2) {
    text = (
      <>
        <b>{names[0]}</b> e <b>{names[1]}</b> estão digitando…
      </>
    );
  } else if (names.length > 2) {
    text = 'Várias pessoas estão digitando…';
  }

  return (
    <div className="typing">
      <span>{text}</span>
    </div>
  );
}
