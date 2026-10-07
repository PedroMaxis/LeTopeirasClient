import type { Channel, ChannelType } from '@letopeiras/shared';
import { expectRow, type Db } from '../db';

interface ChannelRow {
  id: number;
  name: string;
  type: ChannelType;
  position: number;
  category_id: number | null;
  topic: string | null;
  is_private: 0 | 1;
  role_ids: string | null;
  last_message_id: number | null;
}

const parseIds = (csv: string | null): number[] => (csv ? csv.split(',').map(Number) : []);

const toChannel = (row: ChannelRow): Channel => ({
  id: row.id,
  name: row.name,
  type: row.type,
  position: row.position,
  categoryId: row.category_id,
  topic: row.topic,
  isPrivate: row.is_private === 1,
  roleIds: parseIds(row.role_ids),
  lastMessageId: row.last_message_id,
});

const SELECT_CHANNEL = `
  SELECT c.id, c.name, c.type, c.position, c.category_id, c.topic, c.is_private,
         (SELECT group_concat(role_id) FROM channel_roles cr WHERE cr.channel_id = c.id) AS role_ids,
         (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = c.id) AS last_message_id
  FROM channels c`;

export function listChannels(db: Db): Channel[] {
  return db
    .prepare<[], ChannelRow>(`${SELECT_CHANNEL} ORDER BY c.position, c.id`)
    .all()
    .map(toChannel);
}

export function findChannel(db: Db, id: number): Channel | undefined {
  const row = db.prepare<[number], ChannelRow>(`${SELECT_CHANNEL} WHERE c.id = ?`).get(id);
  return row && toChannel(row);
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  categoryId?: number | null | undefined;
  topic?: string | undefined;
  isPrivate?: boolean | undefined;
  roleIds?: number[] | undefined;
}

function setChannelRoles(db: Db, channelId: number, roleIds: number[]): void {
  db.prepare('DELETE FROM channel_roles WHERE channel_id = ?').run(channelId);
  // Unknown role ids are skipped instead of failing the foreign key.
  const insert = db.prepare(
    'INSERT OR IGNORE INTO channel_roles (channel_id, role_id) SELECT ?, id FROM roles WHERE id = ?',
  );
  for (const roleId of roleIds) insert.run(channelId, roleId);
}

export function createChannel(db: Db, input: ChannelInput): Channel {
  return db.transaction(() => {
    const { id } = expectRow(
      db
        .prepare<
          [string, ChannelType, number | null, string | null, number, number],
          { id: number }
        >(
          `INSERT INTO channels (name, type, category_id, topic, is_private, position, created_at)
           VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM channels), ?)
           RETURNING id`,
        )
        .get(
          input.name,
          input.type,
          input.categoryId ?? null,
          input.topic || null,
          input.isPrivate ? 1 : 0,
          Date.now(),
        ),
    );
    if (input.roleIds) setChannelRoles(db, id, input.roleIds);
    return expectRow(findChannel(db, id));
  })();
}

export interface ChannelChanges {
  name?: string | undefined;
  position?: number | undefined;
  categoryId?: number | null | undefined;
  topic?: string | undefined;
  isPrivate?: boolean | undefined;
  roleIds?: number[] | undefined;
}

export function updateChannel(db: Db, id: number, changes: ChannelChanges): Channel | undefined {
  return db.transaction(() => {
    if (!findChannel(db, id)) return undefined;
    const columns: Record<string, string | number | null> = {};
    if (changes.name !== undefined) columns['name'] = changes.name;
    if (changes.position !== undefined) columns['position'] = changes.position;
    if (changes.categoryId !== undefined) columns['category_id'] = changes.categoryId;
    if (changes.topic !== undefined) columns['topic'] = changes.topic || null;
    if (changes.isPrivate !== undefined) columns['is_private'] = changes.isPrivate ? 1 : 0;
    const sets = Object.keys(columns).map((column) => `${column} = ?`);
    if (sets.length) {
      db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(
        ...Object.values(columns),
        id,
      );
    }
    if (changes.roleIds) setChannelRoles(db, id, changes.roleIds);
    return findChannel(db, id);
  })();
}

export function deleteChannel(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM channels WHERE id = ?').run(id).changes === 1;
}
