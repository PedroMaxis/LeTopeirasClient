// Versioned schema migrations, applied in order at startup (see src/db/migrate.ts).
// Never edit a migration that has shipped; add a new one instead.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        username      TEXT    NOT NULL UNIQUE,
        display_name  TEXT    NOT NULL,
        password_hash TEXT    NOT NULL,
        avatar_url    TEXT,
        is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE invites (
        code       TEXT    PRIMARY KEY,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE channels (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        type       TEXT    NOT NULL CHECK (type IN ('text', 'voice')),
        position   INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE messages (
        id         INTEGER PRIMARY KEY,
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content    TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        edited_at  INTEGER
      );
      CREATE INDEX messages_channel_id_id ON messages(channel_id, id);

      CREATE TABLE sessions (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT    NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE read_state (
        user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id           INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        last_read_message_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, channel_id)
      );

      INSERT INTO channels (name, type, position, created_at) VALUES
        ('geral', 'text', 0, unixepoch() * 1000),
        ('Geral', 'voice', 1, unixepoch() * 1000);
    `,
  },
  {
    version: 2,
    name: 'categories-roles-private-channels',
    sql: `
      CREATE TABLE categories (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        position   INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      ALTER TABLE channels ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
      ALTER TABLE channels ADD COLUMN topic TEXT;
      ALTER TABLE channels ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1));

      CREATE TABLE roles (
        id         INTEGER PRIMARY KEY,
        name       TEXT    NOT NULL,
        color      TEXT    NOT NULL,
        position   INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );

      CREATE TABLE channel_roles (
        channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (channel_id, role_id)
      );

      -- Keep the sidebar looking like before: one category per channel type.
      INSERT INTO categories (name, position, created_at) VALUES
        ('Canais de texto', 0, unixepoch() * 1000),
        ('Canais de voz', 1, unixepoch() * 1000);
      UPDATE channels SET category_id = CASE type
        WHEN 'text' THEN (SELECT id FROM categories WHERE position = 0)
        ELSE (SELECT id FROM categories WHERE position = 1)
      END;
    `,
  },
  {
    version: 3,
    name: 'message-mentions',
    sql: `
      CREATE TABLE message_mentions (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (message_id, user_id)
      );
      CREATE INDEX message_mentions_user_id ON message_mentions(user_id, message_id);
    `,
  },
  {
    version: 4,
    name: 'mentions-everyone',
    sql: `
      ALTER TABLE messages ADD COLUMN mentions_everyone INTEGER NOT NULL DEFAULT 0
        CHECK (mentions_everyone IN (0, 1));
    `,
  },
];
