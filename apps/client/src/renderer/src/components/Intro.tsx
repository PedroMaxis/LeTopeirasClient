import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { playSound, type SoundName } from '../lib/sounds';
import { MoleArt } from './ui/Mole';

gsap.registerPlugin(MotionPathPlugin);

const TITLE = 'LeTopeiras';
/** Letters each dig uncovers: "LeT", "opei", "ras". */
const DIG_GROUPS = [
  [0, 3],
  [3, 7],
  [7, 10],
] as const;
const DIRT_COLORS = ['#6e4a33', '#8a5f40', '#4a3424', '#b0805d', '#5a3d2a'];
const SHINE = '#ffe08a'; // the helmet lamp
const TEXT_HEAD = '#fff5ea'; // --text-head
const GLOW_OFF = '0 0 0px rgba(255, 224, 138, 0)';
const GLOW_ON = '0 0 18px rgba(255, 224, 138, 0.75)';

/** Crystals in the soil (ground coordinates), lit up when the lamp's beam sweeps by. */
const GEMS = [
  { x: 250, y: 44, color: '#f0782a' },
  { x: 345, y: 70, color: SHINE },
  { x: 430, y: 36, color: '#f5a26a' },
  { x: 515, y: 62, color: '#f0782a' },
  { x: 600, y: 40, color: SHINE },
];
const PEBBLES = [
  { x: 70, y: 30, w: 9 },
  { x: 205, y: 72, w: 7 },
  { x: 300, y: 24, w: 11 },
  { x: 390, y: 84, w: 8 },
  { x: 470, y: 22, w: 6 },
  { x: 560, y: 80, w: 10 },
  { x: 650, y: 52, w: 8 },
];
const STAR_COUNT = 26;

const random = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Startup animation. A light travels underground as the mole tunnels in, the ground bulges
 * and it pops out of a hole; it looks around, digs to the right and each dig unearths part of
 * "LeTopeiras" (the letters shake dirt off). The helmet lamp's beam then sweeps the title and
 * lights crystals in the soil, "CLIENT" shows engraved in the ground, and the scene closes in
 * an iris on the mole, which winks. Click or any key skips to the iris. The app loads
 * underneath meanwhile.
 */
export function Intro({ onDone }: { onDone(): void }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let ctx: gsap.Context | null = null;
    let cancelled = false;
    // Letter positions (for the falling dirt) need the real font.
    void document.fonts.ready.then(() => {
      if (!cancelled) ctx = gsap.context(() => play(el, onDone), el);
    });
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, [onDone]);

  return (
    <div className="intro" ref={root} aria-hidden="true">
      <div className="intro-stars">
        {Array.from({ length: STAR_COUNT }, (_, i) => (
          <span key={i} className="intro-star" />
        ))}
      </div>
      <div className="intro-camera">
        <div className="intro-stage">
          <div className="intro-ground soil">
            <svg className="intro-ground-art" width="720" height="110" viewBox="0 0 720 110">
              {/* Roots hanging from the surface. */}
              <path className="intro-root" d="M300 0c-2 14 6 20 2 34M304 14c6 4 10 4 14 12" />
              <path className="intro-root" d="M520 0c3 10-4 18 0 30M518 12c-5 3-9 9-10 16" />
              <path className="intro-tunnel" d="M0 80C80 80 100 44 140 48S152 24 162 10" />
            </svg>
            {PEBBLES.map((p, i) => (
              <span
                key={i}
                className="intro-pebble"
                style={{ left: p.x, top: p.y, width: p.w, height: p.w * 0.7 }}
              />
            ))}
            {GEMS.map((g, i) => (
              <span
                key={i}
                className="intro-gem"
                style={{ left: g.x, top: g.y, background: g.color, color: g.color }}
              />
            ))}
            <span className="intro-digger" />
            <span className="intro-client">
              {[...'Client'].map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </span>
          </div>
          <span className="intro-hole" />
          <span className="intro-mound" />
          <div className="intro-above">
            <div className="intro-mole">
              <MoleArt className="intro-mole-svg" />
              <span className="intro-lamp" />
            </div>
            <div className="intro-title">
              {[...TITLE].map((letter, i) => (
                <span key={i} className="intro-letter">
                  {letter}
                </span>
              ))}
            </div>
          </div>
          <span className="intro-beam" />
          <div className="intro-dirt-layer" />
        </div>
      </div>
    </div>
  );
}

/** Builds and runs the timeline; returns the cleanup gsap.context calls on revert. */
function play(el: HTMLElement, onDone: () => void): () => void {
  const q = gsap.utils.selector(el);
  const stage = q('.intro-stage')[0] as HTMLElement;
  const dirtLayer = q('.intro-dirt-layer')[0] as HTMLElement;
  const letters = q('.intro-letter') as HTMLElement[];
  const title = q('.intro-title')[0] as HTMLElement;
  const mole = q('.intro-mole')[0] as HTMLElement;
  const tunnel = el.querySelector<SVGPathElement>('.intro-tunnel');
  if (!tunnel) return () => undefined;
  const tunnelLength = tunnel.getTotalLength();

  const tl = gsap.timeline({ defaults: { ease: 'power2.out' }, onComplete: onDone });
  const sound = (at: number, name: SoundName) => tl.call(() => playSound(name), [], at);

  /** A clod of dirt flying from (x, y) in stage coordinates. */
  const clod = (
    at: number,
    x: number,
    y: number,
    path: { dx: number; up: number; fall: number },
  ) => {
    const piece = document.createElement('span');
    piece.className = 'intro-dirt';
    const size = random(3, 9);
    gsap.set(piece, {
      left: x,
      top: y,
      width: size,
      height: size * random(0.7, 1),
      backgroundColor: DIRT_COLORS[Math.floor(random(0, DIRT_COLORS.length))] ?? '#6e4a33',
      opacity: 0,
    });
    dirtLayer.appendChild(piece);
    const duration = random(0.5, 0.85);
    tl.add(
      gsap
        .timeline()
        .set(piece, { opacity: 1 })
        .to(piece, { x: path.dx, rotation: random(-220, 220), duration, ease: 'none' }, 0)
        .to(piece, { y: -path.up, duration: duration * 0.4, ease: 'power2.out' }, 0)
        .to(piece, { y: path.fall, duration: duration * 0.6, ease: 'power2.in' }, '>')
        .to(piece, { opacity: 0, duration: 0.25 }, '>-0.05'),
      at,
    );
  };
  /** Dirt thrown out of the hole; `right` throws it to the right (digging). */
  const burst = (at: number, count: number, right: boolean) => {
    for (let i = 0; i < count; i++) {
      clod(at + random(0, 0.08), 118, 186, {
        dx: right ? random(30, 230) : random(-120, 120),
        up: random(40, 120),
        fall: random(-2, 12),
      });
    }
  };
  /** Crumbs shaken off a letter as it comes out, falling back into the ground. */
  const crumbs = (at: number, letter: HTMLElement) => {
    const x = title.offsetLeft + letter.offsetLeft + letter.offsetWidth / 2;
    for (let i = 0; i < 3; i++) {
      clod(at + random(0.1, 0.25), x + random(-12, 12), 150 + random(0, 20), {
        dx: random(-14, 14),
        up: random(4, 16),
        fall: random(30, 45),
      });
    }
  };

  for (const star of q('.intro-star')) {
    const size = random(1, 2.6);
    gsap.set(star, {
      left: `${random(2, 98)}%`,
      top: `${random(3, 48)}%`,
      width: size,
      height: size,
    });
    gsap.fromTo(
      star,
      { opacity: random(0.1, 0.4) },
      {
        opacity: random(0.6, 1),
        duration: random(0.6, 1.6),
        repeat: -1,
        yoyo: true,
        delay: random(0, 1),
      },
    );
  }
  gsap.set(tunnel, { strokeDasharray: tunnelLength, strokeDashoffset: tunnelLength });

  tl.set(stage, { visibility: 'visible' })
    .from(stage, { opacity: 0, y: 24, duration: 0.5 }, 0)
    .fromTo('.intro-camera', { scale: 1.08 }, { scale: 1, duration: 4.8, ease: 'power1.out' }, 0)
    .from('.intro-stars', { opacity: 0, duration: 0.8 }, 0)

    // 1. Tunneling: the lamp's light moves underground towards the hole.
    .to(tunnel, { strokeDashoffset: 0, duration: 1.05, ease: 'none' }, 0.3)
    .fromTo('.intro-digger', { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.3)
    .to(
      '.intro-digger',
      {
        motionPath: { path: tunnel, align: tunnel, alignOrigin: [0.5, 0.5] },
        duration: 1.05,
        ease: 'none',
      },
      0.3,
    )

    // 2. The ground bulges and shakes, then the mole pops out.
    .from('.intro-mound', { scaleY: 0, duration: 0.25, ease: 'back.out(3)' }, 1.15)
    .to('.intro-mound', { x: 2, duration: 0.05, repeat: 5, yoyo: true, ease: 'none' }, 1.2)
    .to('.intro-digger', { opacity: 0, duration: 0.1 }, 1.4)
    .to('.intro-mound', { scaleY: 0, scaleX: 1.4, opacity: 0, duration: 0.2 }, 1.45)
    .from('.intro-hole', { scaleX: 0, duration: 0.2 }, 1.45)
    .fromTo(
      mole,
      { y: 130, scaleX: 0.8, scaleY: 1.25 },
      { y: -16, scaleX: 1, scaleY: 1, duration: 0.3, ease: 'power3.out' },
      1.45,
    )
    .to(mole, { y: 0, scaleX: 1.14, scaleY: 0.84, duration: 0.12, ease: 'power2.in' }, 1.75)
    .to(mole, { scaleX: 1, scaleY: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' }, 1.87)
    .to(
      stage,
      { keyframes: { x: [0, -4, 4, -3, 2, 0], y: [0, 2, -2, 1, 0, 0] }, duration: 0.3 },
      1.5,
    )
    .to('.intro-lamp', { keyframes: { opacity: [0, 1, 0.3, 1] }, duration: 0.45 }, 1.95);
  burst(1.5, 22, false);
  sound(0.35, 'introDig');
  sound(0.7, 'introDig');
  sound(1.05, 'introDig');
  sound(1.48, 'introPop');

  // 3. It blinks and looks to the right.
  tl.to(
    '.m-eye-l, .m-eye-r',
    { scaleY: 0.1, transformOrigin: '50% 50%', duration: 0.07, yoyo: true, repeat: 1 },
    2.2,
  ).to('.m-eyes', { x: 2, duration: 0.2 }, 2.4);

  // 4. Three digs, each uncovering part of the title.
  DIG_GROUPS.forEach(([from, to], i) => {
    const at = 2.6 + i * 0.36;
    const group = letters.slice(from, to);
    tl.to(mole, { y: 7, rotation: 12, duration: 0.11, ease: 'power1.in' }, at)
      .to(mole, { y: 0, rotation: 0, duration: 0.2, ease: 'back.out(3)' }, at + 0.11)
      .to(
        '.m-paw-r',
        {
          x: 7,
          y: -9,
          rotation: -30,
          transformOrigin: '30% 50%',
          duration: 0.1,
          yoyo: true,
          repeat: 1,
        },
        at,
      )
      .to('.m-paw-l', { x: 3, y: -5, duration: 0.1, yoyo: true, repeat: 1 }, at + 0.06)
      .fromTo(
        group,
        { yPercent: 115, rotation: () => random(-14, 14) },
        { yPercent: 0, rotation: 0, duration: 0.55, ease: 'back.out(1.8)', stagger: 0.05 },
        at + 0.08,
      );
    burst(at + 0.05, 10, true);
    group.forEach((letter, j) => crumbs(at + 0.08 + j * 0.05, letter));
    sound(at, 'introDig');
  });

  // 5. The lamp's beam sweeps the title and lights the crystals; "CLIENT" shows in the soil.
  tl.fromTo('.intro-beam', { opacity: 0, rotation: -22 }, { opacity: 1, duration: 0.25 }, 3.75)
    .to('.intro-beam', { rotation: 9, duration: 0.95, ease: 'sine.inOut' }, 3.75)
    .to('.intro-beam', { opacity: 0, duration: 0.3 }, 4.55)
    .to(
      letters,
      {
        keyframes: {
          color: [TEXT_HEAD, SHINE, TEXT_HEAD],
          textShadow: [GLOW_OFF, GLOW_ON, GLOW_OFF],
        },
        duration: 0.5,
        stagger: 0.05,
        ease: 'none',
      },
      3.85,
    )
    .fromTo(
      '.intro-gem',
      { scale: 0.6, opacity: 0.35 },
      {
        keyframes: { scale: [0.6, 1.7, 1], opacity: [0.35, 1, 0.8] },
        duration: 0.45,
        stagger: 0.12,
      },
      3.9,
    )
    .from(
      '.intro-client span',
      { opacity: 0, y: 6, filter: 'blur(4px)', duration: 0.4, stagger: 0.06 },
      4.1,
    )
    .to('.m-eyes', { x: 0, duration: 0.2 }, 4.5)
    .to(mole, { y: -10, duration: 0.18, yoyo: true, repeat: 1 }, 4.55);
  sound(3.9, 'introSparkle');

  // 6. Iris out onto the mole, which winks before it closes.
  const iris = (radius: string) => () => {
    const m = mole.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const x = m.left + m.width / 2 - box.left;
    const y = m.top + m.height / 2 - box.top;
    return `circle(${radius} at ${x}px ${y}px)`;
  };
  tl.addLabel('out', 5.05)
    .fromTo(
      el,
      { clipPath: iris('150%') },
      { clipPath: iris('90px'), duration: 0.55, ease: 'power2.inOut' },
      'out',
    )
    .to(
      '.m-eye-r',
      {
        scaleY: 0.1,
        transformOrigin: '50% 50%',
        duration: 0.08,
        yoyo: true,
        repeat: 1,
        repeatDelay: 0.12,
      },
      'out+=0.6',
    )
    .to(el, { clipPath: iris('0px'), duration: 0.3, ease: 'power2.in' }, 'out+=0.95');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tl.seek(tl.labels['out'] ?? 0, true).pause();
    gsap.delayedCall(0.8, () => tl.play());
  }

  const skip = () => {
    if (tl.time() < (tl.labels['out'] ?? 0)) tl.seek('out', true).play();
  };
  el.addEventListener('click', skip);
  window.addEventListener('keydown', skip);
  return () => {
    el.removeEventListener('click', skip);
    window.removeEventListener('keydown', skip);
  };
}
