import { describe, expect, it } from 'vitest';
import { NOTE_MAX, parseNotes, withNote } from './notes';

describe('parseNotes', () => {
  it('reads saved notes and ignores junk', () => {
    expect(parseNotes('{"3":"joga de noite","4":""," 5":1}')).toEqual({ '3': 'joga de noite' });
    expect(parseNotes('nada')).toEqual({});
    expect(parseNotes('[1,2]')).toEqual({});
    expect(parseNotes(null)).toEqual({});
  });
});

describe('withNote', () => {
  it('sets, trims and replaces a note', () => {
    const one = withNote({}, 3, '  amigo do trabalho ');
    expect(one).toEqual({ '3': 'amigo do trabalho' });
    expect(withNote(one, 3, 'outro')).toEqual({ '3': 'outro' });
  });

  it('removes the note when the text is empty, keeping the others', () => {
    expect(withNote({ '3': 'a', '4': 'b' }, 3, '   ')).toEqual({ '4': 'b' });
  });

  it('cuts the text at the limit', () => {
    expect(withNote({}, 1, 'x'.repeat(NOTE_MAX + 50))['1']).toHaveLength(NOTE_MAX);
  });

  it('does not change the notes it was given', () => {
    const notes = { '3': 'a' };
    withNote(notes, 3, 'b');
    expect(notes).toEqual({ '3': 'a' });
  });
});
