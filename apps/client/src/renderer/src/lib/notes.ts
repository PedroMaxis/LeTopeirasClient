// Private notes about people ("Nota" in the member card): only this PC sees them.

export const NOTE_MAX = 256;

export type Notes = Record<string, string>;

export function parseNotes(raw: string | null): Notes {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const notes: Notes = {};
    for (const [id, text] of Object.entries(parsed)) {
      if (typeof text === 'string' && text.trim()) notes[id] = text.slice(0, NOTE_MAX);
    }
    return notes;
  } catch {
    return {};
  }
}

/** The notes with `text` (trimmed, cut at NOTE_MAX) for that person; empty text removes it. */
export function withNote(notes: Notes, userId: number, text: string): Notes {
  const { [String(userId)]: _old, ...rest } = notes;
  const clean = text.trim().slice(0, NOTE_MAX);
  return clean ? { ...rest, [String(userId)]: clean } : rest;
}

const storageKey = (myId: number) => `letopeiras.notes.${myId}`;

function readNotes(myId: number): Notes {
  try {
    return parseNotes(localStorage.getItem(storageKey(myId)));
  } catch {
    return {};
  }
}

export const loadNote = (myId: number, userId: number): string =>
  readNotes(myId)[String(userId)] ?? '';

export function saveNote(myId: number, userId: number, text: string): void {
  try {
    localStorage.setItem(storageKey(myId), JSON.stringify(withNote(readNotes(myId), userId, text)));
  } catch {
    // The note just won't persist.
  }
}
