import type { Embed, Message } from '@letopeiras/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db';
import { findCachedPreview, savePreview } from '../repo/link-previews';
import { findMessage, setMessageEmbeds } from '../repo/messages';
import { previewUrls } from './link-preview';

/** A good preview stays a day; a failed one is retried after an hour. */
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_FAILED_MS = 60 * 60 * 1000;
/** Fetches running at once, for the whole server. */
const CONCURRENCY = 4;

export type PreviewFetcher = (url: string) => Promise<Embed | null>;

export interface EmbedServiceDeps {
  db: Db;
  fetchPreview: PreviewFetcher;
  log: FastifyBaseLogger;
  /** The message got (or lost) previews: tell the channel. */
  onUpdated(message: Message): void;
}

/**
 * Fills in link previews after a message is sent or edited, without holding up the message
 * itself: cached by URL, a few fetches at a time, and only applied if the message still
 * has the same text when they arrive.
 */
export class EmbedService {
  private running = 0;
  private readonly queue: Array<() => void> = [];
  private closed = false;
  /** Pending work, so tests (and shutdown) can wait for it. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: EmbedServiceDeps) {}

  /** Recomputes the previews of a message just sent or edited. */
  schedule(message: Message): void {
    if (this.closed) return;
    const urls = previewUrls(message.content);
    // Nothing to fetch: only an edit that removed the links changes anything.
    if (urls.length === 0 && message.embeds.length === 0) return;
    const task = this.update(message, urls).catch((err: unknown) =>
      this.deps.log.warn({ err, messageId: message.id }, 'Link previews failed'),
    );
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));
  }

  /** Resolves once everything scheduled so far is done. */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }

  close(): void {
    this.closed = true;
  }

  private async update(message: Message, urls: string[]): Promise<void> {
    const found = await Promise.all(urls.map((url) => this.preview(url)));
    const embeds = found.filter((e): e is Embed => e !== null);
    const { db } = this.deps;
    // Edited (or deleted) meanwhile: that edit scheduled its own update.
    const current = findMessage(db, message.id);
    if (!current || current.content !== message.content || this.closed) return;
    if (JSON.stringify(current.embeds) === JSON.stringify(embeds)) return;
    if (!setMessageEmbeds(db, message.id, embeds)) return;
    const updated = findMessage(db, message.id);
    if (updated) this.deps.onUpdated(updated);
  }

  private async preview(url: string): Promise<Embed | null> {
    const { db } = this.deps;
    const cached = findCachedPreview(db, url);
    const maxAge = cached?.embed ? FRESH_MS : RETRY_FAILED_MS;
    if (cached && Date.now() - cached.fetchedAt < maxAge) return cached.embed;
    let embed: Embed | null = null;
    try {
      embed = await this.limited(() => this.deps.fetchPreview(url));
    } catch (err) {
      this.deps.log.debug({ err, url }, 'Link preview fetch failed');
    }
    if (!this.closed) savePreview(db, url, embed);
    return embed;
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await work();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}
