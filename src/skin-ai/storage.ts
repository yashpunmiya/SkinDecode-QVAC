import * as SQLite from 'expo-sqlite';
import type { SkinAIContextAttachment, SkinAIMessage } from './types';

const MAX_STORED_MESSAGES = 80;
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function database() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync('skindecode-skin-ai.db');
      await db.execAsync(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS skin_ai_messages (
          user_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user','assistant')),
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attachments_json TEXT NOT NULL DEFAULT '[]',
          PRIMARY KEY(user_id,message_id)
        );
        CREATE INDEX IF NOT EXISTS skin_ai_messages_recent_idx ON skin_ai_messages(user_id,created_at DESC);`);
      await db.execAsync(`CREATE TABLE IF NOT EXISTS skin_ai_context_cache (
        user_id TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL, cached_at INTEGER NOT NULL,
        PRIMARY KEY(user_id,cache_key)
      );`);
      return db;
    })().catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

export async function loadSkinAIHistory(userId: string): Promise<SkinAIMessage[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ message_id: string; role: 'user' | 'assistant'; text: string; created_at: string; attachments_json: string }>(
    'SELECT message_id,role,text,created_at,attachments_json FROM skin_ai_messages WHERE user_id=? ORDER BY created_at DESC LIMIT ?', userId, MAX_STORED_MESSAGES,
  );
  return rows.reverse().map((row) => {
    let attachments: SkinAIMessage['attachments'] = [];
    try { attachments = JSON.parse(row.attachments_json); } catch { attachments = []; }
    // Photo paths are intentionally excluded from persisted conversational history.
    return { id: row.message_id, role: row.role, text: row.text, createdAt: row.created_at, attachments: attachments?.map(({ localPhotoUri: _uri, ...item }) => item) };
  });
}

export async function saveSkinAIMessage(userId: string, message: SkinAIMessage) {
  const db = await database();
  const attachments = (message.attachments || []).map(({ localPhotoUri: _uri, ...item }) => item);
  await db.runAsync(`INSERT OR REPLACE INTO skin_ai_messages(user_id,message_id,role,text,created_at,attachments_json)
    VALUES(?,?,?,?,?,?)`, userId, message.id, message.role, message.text, message.createdAt, JSON.stringify(attachments));
  await db.runAsync(`DELETE FROM skin_ai_messages WHERE user_id=? AND message_id NOT IN
    (SELECT message_id FROM skin_ai_messages WHERE user_id=? ORDER BY created_at DESC LIMIT ?)`, userId, userId, MAX_STORED_MESSAGES);
}

export async function clearSkinAIHistory(userId: string) {
  const db = await database();
  await db.runAsync('DELETE FROM skin_ai_messages WHERE user_id=?', userId);
  await db.runAsync('DELETE FROM skin_ai_context_cache WHERE user_id=?', userId);
}

export async function getCachedSkinAIContext(userId: string, key: string, maxAgeMs = 60_000): Promise<SkinAIContextAttachment | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value_json: string; cached_at: number }>(
    'SELECT value_json,cached_at FROM skin_ai_context_cache WHERE user_id=? AND cache_key=?', userId, key,
  );
  if (!row || Date.now() - row.cached_at > maxAgeMs) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

export async function cacheSkinAIContext(userId: string, key: string, attachment: SkinAIContextAttachment) {
  const db = await database();
  const { localPhotoUri: _uri, ...safeAttachment } = attachment;
  await db.runAsync('INSERT OR REPLACE INTO skin_ai_context_cache(user_id,cache_key,value_json,cached_at) VALUES(?,?,?,?)',
    userId, key, JSON.stringify(safeAttachment), Date.now());
}
