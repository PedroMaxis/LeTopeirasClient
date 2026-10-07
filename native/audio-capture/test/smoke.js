// Manual check: captures 3 s of system audio (excluding this Node process) and prints levels.
// Play something on the PC while it runs. Usage: pnpm --filter @letopeiras/audio-capture smoke
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const addon = require('../build/Release/audio_capture.node');

const mode = process.argv[2] ?? 'exclude';
const pid = Number(process.argv[3] ?? process.pid);
let blocks = 0;
let peak = 0;
let sumSquares = 0;
let samples = 0;
// Goertzel amplitude at a probe frequency (default 440 Hz, the test tone), averaged per block.
const probeHz = Number(process.env.PROBE_HZ ?? 440);
let probeSum = 0;

function goertzel(block, channels, sampleRate, freq) {
  const k = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  const frames = block.length / channels;
  for (let i = 0; i < frames; i++) {
    const x = block[i * channels];
    const s0 = x + k * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - k * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / frames;
}

const capture = new addon.AudioCapture({ pid, mode }, (block) => {
  blocks++;
  for (const s of block) {
    peak = Math.max(peak, Math.abs(s));
    sumSquares += s * s;
  }
  samples += block.length;
  probeSum += goertzel(block, addon.channels, addon.sampleRate, probeHz);
  if (block.length !== addon.blockFrames * addon.channels) {
    console.error('unexpected block size', block.length);
  }
});

console.log(`capturing (${mode} pid ${pid}) at ${addon.sampleRate} Hz…`);
capture.start();
setTimeout(() => {
  capture.stop();
  const rms = samples ? Math.sqrt(sumSquares / samples) : 0;
  console.log(
    JSON.stringify({
      blocks,
      seconds: blocks / 100,
      peak: peak.toFixed(4),
      rms: rms.toFixed(4),
      [`amp${probeHz}Hz`]: (blocks ? probeSum / blocks : 0).toFixed(4),
    }),
  );
}, 3000);
