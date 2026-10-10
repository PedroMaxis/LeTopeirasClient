import { useEffect, useState } from 'react';
import { CHANGELOG, compareVersions, notesSince } from '../changelog';
import { renderMarkdown } from '../lib/markdown';
import { Mole } from './ui/Mole';

const SEEN_KEY = 'letopeiras.lastSeenVersion';
/** Present for anyone who used the app before this modal existed. */
const SETTINGS_KEY = 'letopeiras.settings';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * "Novidades" once after an update: the changelog entries since the last version this PC saw.
 * A fresh install shows nothing; someone updating from before this modal sees the current
 * version's notes.
 */
export function WhatsNew() {
  const [notes, setNotes] = useState<typeof CHANGELOG>([]);

  useEffect(() => {
    let cancelled = false;
    void window.api.getAppInfo().then(({ version }) => {
      if (cancelled) return;
      const seen = read(SEEN_KEY);
      try {
        localStorage.setItem(SEEN_KEY, version);
      } catch {
        // Then it may show again next time; harmless.
      }
      if (seen && compareVersions(version, seen) <= 0) return;
      if (!seen && !read(SETTINGS_KEY)) return;
      setNotes(seen ? notesSince(seen, version) : CHANGELOG.filter((e) => e.version === version));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (notes.length === 0) return null;
  const close = () => setNotes([]);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal whats-new"
        role="dialog"
        aria-label="Novidades"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <header className="whats-new-header">
          <Mole size={64} />
          <div>
            <h2>Novidades</h2>
            <p>O que mudou desde a última vez que você abriu o app.</p>
          </div>
        </header>
        <div className="whats-new-body">
          {notes.map((entry) => (
            <section key={entry.version}>
              <h3>Versão {entry.version}</h3>
              <ul>
                {entry.items.map((item, i) => (
                  <li key={i}>{renderMarkdown(item)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button primary" autoFocus onClick={close}>
            Show!
          </button>
        </footer>
      </div>
    </div>
  );
}
