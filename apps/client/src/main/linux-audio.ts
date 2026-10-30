import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SINK_NAME = 'letopeiras_share';
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BLOCK_FRAMES = 480; // 10 ms, same as the Windows addon
const BLOCK_BYTES = BLOCK_FRAMES * CHANNELS * 4;

async function pactl(...args: string[]): Promise<string> {
  const { stdout } = await run('pactl', args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/** pid → parent pid for every process, read from /proc. */
function parentMap(): Map<number, number> {
  const parents = new Map<number, number>();
  for (const entry of readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // "pid (comm) S ppid ...": comm may hold spaces and parentheses, so cut at the last ')'.
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      parents.set(pid, Number(fields[1]));
    } catch {
      // The process exited meanwhile.
    }
  }
  return parents;
}

/** `root` and everything it spawned (Chromium plays audio from a child process). */
function inTree(pid: number, root: number, parents: Map<number, number>): boolean {
  for (let current = pid, hops = 0; current > 1 && hops < 64; hops++) {
    if (current === root) return true;
    const parent = parents.get(current);
    if (parent === undefined) return false;
    current = parent;
  }
  return false;
}

interface SinkInput {
  index: number;
  sink: number;
  owner_module: string | null;
  properties: Record<string, string>;
}

/**
 * Pid of the process that owns an X11 window (`_NET_WM_PID`), or 0. Wayland windows have no
 * such thing, so the id of a portal source never resolves.
 */
export async function x11WindowProcessId(windowId: number): Promise<number> {
  try {
    const { stdout } = await run('xprop', ['-id', String(windowId), '_NET_WM_PID'], {
      timeout: 2000,
    });
    return Number(/=\s*(\d+)/.exec(stdout)?.[1]) || 0;
  } catch {
    return 0;
  }
}

/** Whether `pactl` and `parec` exist and a PulseAudio/PipeWire server answers. */
export async function linuxAudioAvailable(): Promise<string | null> {
  try {
    await pactl('info');
    await run('parec', ['--version']);
    return null;
  } catch {
    return 'precisa de PipeWire ou PulseAudio (pactl e parec)';
  }
}

/** Removes a share sink left behind by a crash. */
async function unloadStale(): Promise<void> {
  const modules = await pactl('list', 'short', 'modules');
  for (const line of modules.split('\n')) {
    const [id, name, args = ''] = line.split('\t');
    const ours =
      (name === 'module-null-sink' && args.includes(`sink_name=${SINK_NAME}`)) ||
      (name === 'module-loopback' && args.includes(`source=${SINK_NAME}.monitor`));
    if (ours && id) await pactl('unload-module', id).catch(() => undefined);
  }
}

/**
 * Same contract as the Windows addon: interleaved float32 stereo at 48 kHz in 10 ms blocks.
 *
 * Linux has no process loopback, so the streams that should be shared are moved to a private
 * null sink: a loopback plays it on the real output (nothing goes silent) and `parec` records
 * its monitor. 'include' moves only `pid`'s process tree; 'exclude' moves everything except
 * ours, so the call voices stay out of the share.
 */
export class LinuxAudioCapture {
  private modules: string[] = [];
  private realSink = '';
  private parec: ChildProcess | null = null;
  private subscribe: ChildProcess | null = null;
  private routing = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly options: { pid: number; mode: 'include' | 'exclude' },
    private readonly onData: (block: Float32Array) => void,
  ) {}

  async start(): Promise<void> {
    await unloadStale();
    this.realSink = (await pactl('get-default-sink')).trim();
    try {
      this.modules.push(
        (
          await pactl(
            'load-module',
            'module-null-sink',
            `sink_name=${SINK_NAME}`,
            'sink_properties=device.description=LeTopeiras-Share',
            'rate=48000',
            'channels=2',
          )
        ).trim(),
      );
      this.modules.push(
        (
          await pactl(
            'load-module',
            'module-loopback',
            `source=${SINK_NAME}.monitor`,
            `sink=${this.realSink}`,
            'latency_msec=30',
          )
        ).trim(),
      );
      await this.route();
      this.watchNewStreams();
      this.record();
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  private route(): Promise<void> {
    // Serialized: events can arrive in bursts, and a stream must not be moved twice at once.
    this.routing = this.routing.then(() => this.moveStreams()).catch(() => undefined);
    return this.routing;
  }

  private async moveStreams(): Promise<void> {
    if (this.stopped) return;
    const inputs = JSON.parse(await pactl('-f', 'json', 'list', 'sink-inputs')) as SinkInput[];
    const sinks = JSON.parse(await pactl('-f', 'json', 'list', 'sinks')) as {
      index: number;
      name: string;
    }[];
    const shareIndex = sinks.find((s) => s.name === SINK_NAME)?.index;
    if (shareIndex === undefined) return;
    const parents = parentMap();
    for (const input of inputs) {
      // The loopback's own playback stream belongs to the module, never to an app.
      if (input.owner_module !== null || input.sink === shareIndex) continue;
      const pid = Number(input.properties['application.process.id']);
      const ours = Number.isInteger(pid) && inTree(pid, process.pid, parents);
      const wanted =
        this.options.mode === 'exclude'
          ? !ours
          : Number.isInteger(pid) && inTree(pid, this.options.pid, parents);
      if (wanted) await pactl('move-sink-input', String(input.index), SINK_NAME).catch(() => {});
    }
  }

  /** Apps that start playing after the share began are routed as they appear. */
  private watchNewStreams(): void {
    const child = spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      if (lines.some((line) => /'new' on sink-input/.test(line))) void this.route();
    });
    this.subscribe = child;
  }

  private record(): void {
    const child = spawn(
      'parec',
      [
        `--device=${SINK_NAME}.monitor`,
        '--format=float32le',
        `--rate=${SAMPLE_RATE}`,
        `--channels=${CHANNELS}`,
        '--latency-msec=10',
        '--raw',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let pending: Buffer = Buffer.alloc(0);
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= BLOCK_BYTES) {
        // Copy: the slice shares memory with the buffer that keeps filling.
        const block = new Float32Array(BLOCK_FRAMES * CHANNELS);
        new Uint8Array(block.buffer).set(pending.subarray(0, BLOCK_BYTES));
        pending = pending.subarray(BLOCK_BYTES);
        this.onData(block);
      }
    });
    this.parec = child;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.parec?.kill();
    this.subscribe?.kill();
    try {
      // Hand the streams back first, so a module being unloaded never strands them.
      const inputs = JSON.parse(await pactl('-f', 'json', 'list', 'sink-inputs')) as SinkInput[];
      const sinks = JSON.parse(await pactl('-f', 'json', 'list', 'sinks')) as {
        index: number;
        name: string;
      }[];
      const shareIndex = sinks.find((s) => s.name === SINK_NAME)?.index;
      for (const input of inputs) {
        if (input.sink === shareIndex && input.owner_module === null && this.realSink)
          await pactl('move-sink-input', String(input.index), this.realSink).catch(() => {});
      }
    } catch {
      // The sound server is gone; nothing to hand back.
    }
    for (const id of this.modules.reverse()) await pactl('unload-module', id).catch(() => {});
    this.modules = [];
  }
}
