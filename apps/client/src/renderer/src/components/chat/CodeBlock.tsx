import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A fenced code block: colors for known languages (loaded on demand) and a copy button. */
export function CodeBlock({ code, language }: { code: string; language: string | undefined }) {
  const [colored, setColored] = useState<ReactNode[] | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    import('../../lib/highlight').then(
      ({ highlight }) => {
        if (!cancelled) setColored(highlight(code, language));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <pre className="md-codeblock" data-language={language}>
      <button type="button" className="md-copy" onClick={copy}>
        {copied ? 'Copiado!' : 'Copiar'}
      </button>
      <code>{colored ?? code}</code>
    </pre>
  );
}
