import { useState } from 'react';
import { hostOf, isTrustedDomain, trustDomain } from '../../lib/links';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/** A named link: hovering shows the real address, clicking asks first (unless the domain is trusted). */
export function ExternalLink({ href, text }: { href: string; text: string }) {
  const [asking, setAsking] = useState(false);
  const [remember, setRemember] = useState(false);
  const host = hostOf(href) ?? href;

  const open = () => window.open(href);

  return (
    <>
      <a
        href={href}
        title={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.preventDefault();
          if (isTrustedDomain(host)) open();
          else setAsking(true);
        }}
      >
        {text}
      </a>
      {asking && (
        <ConfirmDialog
          title="Abrir link externo?"
          confirmLabel="Abrir"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            if (remember) trustDomain(host);
            setAsking(false);
            open();
          }}
        >
          <p>
            Você vai sair do LeTopeiras e abrir <strong>{host}</strong> no navegador.
          </p>
          <blockquote className="confirm-quote">{href}</blockquote>
          <label className="link-trust">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Não perguntar de novo para este domínio
          </label>
        </ConfirmDialog>
      )}
    </>
  );
}
