import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { getPluginDBPath } from '../utils/paths';

export class DataService {
  private dbs: Map<string, Database.Database> = new Map();

  private getDB(pluginId: string): Database.Database {
    let db = this.dbs.get(pluginId);
    if (!db) {
      const dbPath = getPluginDBPath(pluginId);
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      this.dbs.set(pluginId, db);
    }
    return db;
  }

  get(pluginId: string, key: string): unknown {
    const db = this.getDB(pluginId);
    const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  set(pluginId: string, key: string, value: unknown): void {
    const db = this.getDB(pluginId);
    db.prepare(
      'INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, strftime(\'%s\',\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, JSON.stringify(value));
  }

  delete(pluginId: string, key: string): void {
    const db = this.getDB(pluginId);
    db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
  }

  closeAll(): void {
    for (const db of this.dbs.values()) db.close();
    this.dbs.clear();
  }
}
