import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { gsap } from 'gsap';

const DIRT_COLORS = ['#6e4a33', '#8a5f40', '#4a3424', '#b0805d'];

const random = (min: number, max: number) => min + Math.random() * (max - min);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The logo's miner mole (same shapes and colors as ui/Logo.tsx), split into parts that can
 * move: `.m-paw-l/-r`, `.m-body`, `.m-eyes` with `.m-eye-l/-r`.
 */
export function MoleArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`mole-art ${className}`} viewBox="0 0 64 64" overflow="visible">
      <ellipse className="m-paw-l" cx="18" cy="56" rx="7" ry="4.5" fill="#e9b58c" />
      <ellipse className="m-paw-r" cx="46" cy="56" rx="7" ry="4.5" fill="#e9b58c" />
      <g className="m-body">
        <circle cx="32" cy="37" r="20" fill="#6e4a33" />
        <ellipse cx="32" cy="46" rx="11.5" ry="8.5" fill="#b0805d" />
        <g className="m-eyes">
          <circle className="m-eye-l" cx="24.5" cy="35" r="2.2" fill="#1c120b" />
          <circle className="m-eye-r" cx="39.5" cy="35" r="2.2" fill="#1c120b" />
        </g>
        <ellipse cx="32" cy="41" rx="5" ry="3.6" fill="#f08f8f" />
        <rect x="29.2" y="45" width="2.6" height="4.6" rx="0.8" fill="#fff5ea" />
        <rect x="32.2" y="45" width="2.6" height="4.6" rx="0.8" fill="#fff5ea" />
        <path d="M14 28a18 16.5 0 0 1 36 0z" fill="#f0782a" />
        <rect x="10" y="26" width="44" height="5" rx="2.5" fill="#c95c18" />
        <circle cx="32" cy="19" r="5" fill="#ffe08a" stroke="#1c120b" strokeWidth="2" />
      </g>
    </svg>
  );
}

export interface MoleHandle {
  /** Squints and shakes its head (wrong password). */
  frown(): void;
  /** Jumps, throwing a bit of dirt. */
  jump(): void;
  /** Dives into a hole that opens under it; resolves when it's gone. */
  dive(): Promise<void>;
}

/**
 * The mole, alive: `idle` blinks and its lamp flickers now and then; `dig` digs in a hole in
 * a loop (waiting screens); `peek` comes out of a hole and looks around the first time it
 * scrolls into view. Everything is skipped with reduced motion.
 */
export function Mole({
  size,
  mode = 'idle',
  ref,
}: {
  size: number;
  mode?: 'idle' | 'dig' | 'peek';
  ref?: Ref<MoleHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const ctx = useRef<gsap.Context | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const context = gsap.context((self) => {
      if (reducedMotion()) return;
      blinkLoop(self);
      if (mode === 'dig') digLoop(el, size);
      if (mode === 'peek') return peekWhenVisible(self, el);
    }, el);
    ctx.current = context;
    return () => {
      context.revert();
      ctx.current = null;
    };
  }, [mode, size]);

  useImperativeHandle(
    ref,
    () => ({
      frown() {
        ctx.current?.add(() => {
          gsap
            .timeline()
            .to('.m-eyes', { scaleY: 0.35, transformOrigin: '50% 50%', duration: 0.1 })
            .to(
              '.mole-body',
              { keyframes: { rotation: [0, -10, 9, -6, 4, 0] }, duration: 0.5, ease: 'none' },
              0,
            )
            .to('.m-eyes', { scaleY: 1, duration: 0.15 }, 0.75);
        });
      },
      jump() {
        ctx.current?.add(() => {
          const el = root.current;
          if (!el) return;
          gsap
            .timeline()
            .to('.mole-body', { scaleY: 0.8, scaleX: 1.15, duration: 0.08, ease: 'power1.in' })
            .to('.mole-body', {
              y: -size * 0.55,
              scaleY: 1.1,
              scaleX: 0.92,
              rotation: Math.random() < 0.3 ? 360 : 0,
              duration: 0.28,
              ease: 'power2.out',
            })
            .to('.mole-body', { y: 0, scaleY: 1, scaleX: 1, duration: 0.25, ease: 'bounce.out' })
            .set('.mole-body', { rotation: 0 });
          dirt(el, size, 6, 0.36);
        });
      },
      dive() {
        return new Promise<void>((resolve) => {
          if (!ctx.current || reducedMotion()) return resolve();
          ctx.current.add(() => {
            gsap
              .timeline({ onComplete: resolve })
              .to('.mole-hole', { scaleX: 1, duration: 0.15 })
              .to('.mole-body', { y: -size * 0.15, duration: 0.12, ease: 'power2.out' }, 0)
              .to('.mole-body', { y: size * 1.1, duration: 0.28, ease: 'power2.in' })
              .to('.mole-hole', { scaleX: 0, duration: 0.15 });
          });
        });
      },
    }),
    [size],
  );

  return (
    <div className={`mole mole-${mode}`} ref={root} style={{ width: size, height: size }}>
      <span className="mole-hole" />
      <div className="mole-clip">
        <div className="mole-body">
          <MoleArt />
          <span className="mole-lamp" />
        </div>
      </div>
    </div>
  );
}

/**
 * Blinks every few seconds; sometimes the lamp flickers. Later animations go through
 * `self.add` so their selectors stay scoped to this mole and revert() stops them.
 */
function blinkLoop(self: gsap.Context): void {
  const next = () => {
    self.add(() => gsap.delayedCall(random(2.5, 5.5), blink));
  };
  const blink = () => {
    self.add(() => {
      gsap.to('.m-eye-l, .m-eye-r', {
        scaleY: 0.1,
        transformOrigin: '50% 50%',
        duration: 0.07,
        yoyo: true,
        repeat: 1,
      });
      if (Math.random() < 0.35) {
        gsap.to('.mole-lamp', { keyframes: { opacity: [0.9, 0.2, 0.9, 0.4, 0.9] }, duration: 0.4 });
      }
    });
    next();
  };
  next();
}

/** Digs in its hole forever: dips in, paws working, dirt flying, pops back up. */
function digLoop(el: HTMLElement, size: number): void {
  gsap.set('.mole-hole', { scaleX: 1 });
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.25 });
  tl.to('.mole-body', { y: size * 0.3, rotation: 10, duration: 0.18, ease: 'power1.in' })
    .to('.m-paw-r', { x: 6, y: -8, rotation: -30, transformOrigin: '30% 50%', duration: 0.1 }, 0)
    .to('.m-paw-l', { x: -5, y: -6, duration: 0.1 }, 0.05)
    .call(() => dirt(el, size, 5, 0), [], 0.15)
    .to('.mole-body', { y: 0, rotation: 0, duration: 0.3, ease: 'back.out(2.5)' }, 0.22)
    .to('.m-paw-r, .m-paw-l', { x: 0, y: 0, rotation: 0, duration: 0.2 }, 0.22);
}

/** Comes out of its hole and looks around, once, the first time it's on screen. */
function peekWhenVisible(self: gsap.Context, el: HTMLElement): () => void {
  gsap.set('.mole-body', { y: el.offsetHeight });
  gsap.set('.mole-hole', { scaleX: 0 });
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting) return;
    observer.disconnect();
    self.add(() =>
      gsap
        .timeline()
        .to('.mole-hole', { scaleX: 1, duration: 0.2 })
        .to('.mole-body', { y: 0, duration: 0.45, ease: 'back.out(1.8)' }, 0.1)
        .to('.m-eyes', { x: -2, duration: 0.2 }, 0.7)
        .to('.m-eyes', { x: 2, duration: 0.3 }, 1.1)
        .to('.m-eyes', { x: 0, duration: 0.2 }, 1.6),
    );
  });
  observer.observe(el);
  return () => observer.disconnect();
}

/** A few clods of dirt thrown up from the mole's feet. */
function dirt(el: HTMLElement, size: number, count: number, delay: number): void {
  for (let i = 0; i < count; i++) {
    const clod = document.createElement('span');
    clod.className = 'mole-dirt';
    const s = Math.max(2, size * random(0.04, 0.08));
    el.appendChild(clod);
    gsap.set(clod, {
      width: s,
      height: s,
      left: size / 2,
      top: size * 0.85,
      backgroundColor: DIRT_COLORS[i % DIRT_COLORS.length] ?? '#6e4a33',
    });
    const duration = random(0.45, 0.7);
    gsap
      .timeline({ delay, onComplete: () => clod.remove() })
      .to(clod, { x: random(-size * 0.7, size * 0.7), duration, ease: 'none' }, 0)
      .to(clod, { y: -size * random(0.3, 0.7), duration: duration * 0.4 }, 0)
      .to(clod, { y: size * 0.1, duration: duration * 0.6, ease: 'power2.in' }, '>')
      .to(clod, { opacity: 0, duration: 0.2 }, '>-0.15');
  }
}
