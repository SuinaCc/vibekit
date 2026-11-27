import { clipboard, nativeImage, type NativeImage } from 'electron';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { ConfigService } from './ConfigService';
import { getPluginDataDir } from '../utils/paths';

interface ClipboardRow {
  id: number;
  text: string;
  timestamp: number;
  type: string;
}

export class ClipboardService {
  private configService: ConfigService;
  private lastText = '';
  private lastImageHash = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private db: Database.Database | null = null;
  private ticking = false;

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  async startWatching(intervalMs = 500): Promise<void> {
    if (this.timer) return;
    try {
      this.lastText = await clipboard.readText();
    } catch {
      this.lastText = '';
    }
    this.timer = setInterval(() => { void this.check(); }, intervalMs);
  }

  stopWatching(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  addEntry(text: string, maxEntries: number, type = 'text'): void {
    const db = this.getDB();
    db.prepare('INSERT INTO history (text, timestamp, type) VALUES (?, ?, ?)').run(text, Date.now(), type);
    db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)').run(maxEntries);
  }

  getHistory(limit = 50): ClipboardRow[] {
    const db = this.getDB();
    return db.prepare('SELECT id, text, timestamp, type FROM history ORDER BY id DESC LIMIT ?').all(limit) as ClipboardRow[];
  }

  clearHistory(): void {
    const db = this.getDB();
    db.prepare('DELETE FROM history').run();
  }

  close(): void {
    this.stopWatching();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getDB(): Database.Database {
    if (!this.db) {
      const dbPath = path.join(getPluginDataDir(), '_clipboard.db');
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);
      try { db.exec('ALTER TABLE history ADD COLUMN type TEXT DEFAULT "text"'); } catch {}
      this.db = db;
    }
    return this.db;
  }

  private async check(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const config = this.configService.get();
      if (!config.privacy.clipboardHistoryEnabled) return;

      const image = await this.readImage();
      if (image) {
        const dataUrl = image.toDataURL();
        const hash = this.simpleHash(dataUrl);
        if (hash !== this.lastImageHash) {
          this.lastImageHash = hash;
          const png = image.resize({ width: 200 }).toPNG();
          const dir = path.join(getPluginDataDir(), '_clipboard_thumbs');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const filename = `thumb_${Date.now()}.png`;
          const fullPath = path.join(dir, filename);
          fs.writeFileSync(fullPath, png);
          this.addEntry(fullPath, config.privacy.clipboardMaxEntries, 'image');
          this.lastText = '';
        }
        return;
      }

      const text = await clipboard.readText();
      if (text && text !== this.lastText) {
        this.lastText = text;
        this.lastImageHash = '';
        this.addEntry(text, config.privacy.clipboardMaxEntries, 'text');
      }
    } catch {
      /* clipboard read may fail while another app owns it */
    } finally {
      this.ticking = false;
    }
  }

  private async readImage(): Promise<NativeImage | null> {
    try {
      const items = await clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => value === 'image/png')
          ?? item.types.find((value) => value.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type) as Blob;
        const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
        if (!image.isEmpty()) return image;
      }
    } catch {
      /* no image or unsupported clipboard item */
    }
    return null;
  }

  private simpleHash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(h);
  }
}
