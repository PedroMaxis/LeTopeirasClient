import { useState } from 'react';
import type { Embed } from '@letopeiras/shared';
import { Icon } from '../ui/Icon';

/** Link previews under a message (fetched by the server). Links open in the browser. */
export function Embeds({ embeds }: { embeds: Embed[] }) {
  return (
    <div className="embeds">
      {embeds.map((embed) =>
        embed.kind === 'image' ? (
          <a
            key={embed.url}
            className="embed-image"
            href={embed.url}
            target="_blank"
            rel="noreferrer"
          >
            <img
              src={embed.image ?? embed.url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </a>
        ) : (
          <LinkCard key={embed.url} embed={embed} />
        ),
      )}
    </div>
  );
}

function LinkCard({ embed }: { embed: Embed }) {
  const [playing, setPlaying] = useState(false);
  const isVideo = embed.kind === 'youtube' && embed.videoId !== null;
  return (
    <div className="embed" style={{ borderLeftColor: embed.color ?? undefined }}>
      {embed.siteName && <div className="embed-site">{embed.siteName}</div>}
      {embed.title && (
        <a className="embed-title" href={embed.url} target="_blank" rel="noreferrer">
          {embed.title}
        </a>
      )}
      {embed.description && <div className="embed-description">{embed.description}</div>}
      {isVideo && playing ? (
        // youtube-nocookie: the player without tracking cookies (allowed by the CSP).
        <iframe
          className="embed-player"
          src={`https://www.youtube-nocookie.com/embed/${embed.videoId}?autoplay=1`}
          title={embed.title ?? 'YouTube'}
          allow="autoplay; encrypted-media; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        embed.image &&
        (isVideo ? (
          <button
            type="button"
            className="embed-video"
            aria-label="Assistir aqui"
            title="Assistir aqui"
            onClick={() => setPlaying(true)}
          >
            <img src={embed.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="embed-play">
              <Icon name="play" size={28} />
            </span>
          </button>
        ) : (
          <a className="embed-thumb" href={embed.url} target="_blank" rel="noreferrer">
            <img src={embed.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </a>
        ))
      )}
    </div>
  );
}
