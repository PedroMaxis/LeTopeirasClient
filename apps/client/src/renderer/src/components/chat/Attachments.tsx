import type { Attachment } from '@letopeiras/shared';
import { useState } from 'react';
import { fileUrl } from '../../lib/attachments';
import { ImageViewer } from '../ui/ImageViewer';

const MAX_W = 400;
const MAX_H = 300;

/** Fits an image in the chat box keeping its ratio, so the list never jumps when it loads. */
const fit = (a: { width: number; height: number }, maxW: number, maxH: number) => {
  const scale = Math.min(1, maxW / a.width, maxH / a.height);
  return { width: Math.round(a.width * scale), height: Math.round(a.height * scale) };
};

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  const single = attachments.length === 1;
  return (
    <div className={`attachments ${single ? 'single' : 'grid'}`}>
      {attachments.map((a) => (
        <button key={a.id} type="button" className="attachment" onClick={() => setOpen(a)}>
          <img
            src={fileUrl(a.url)}
            alt=""
            loading="lazy"
            style={fit(a, single ? MAX_W : MAX_W / 2, single ? MAX_H : MAX_H / 2)}
          />
        </button>
      ))}
      {open && <ImageViewer src={fileUrl(open.url)} onClose={() => setOpen(null)} />}
    </div>
  );
}
