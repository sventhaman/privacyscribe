/**
 * SQLite database connection and schema management.
 *
 * All note data is stored locally on the device — never transmitted.
 * The database file lives in the platform app-data directory managed by Tauri.
 */
import Database from '@tauri-apps/plugin-sql'
import { logger } from './logger'

let _db: Database | null = null

/**
 * Returns a shared, lazily-initialised database connection.
 * Subsequent calls return the same instance.
 */
export async function getDb(): Promise<Database> {
  if (_db) return _db
  _db = await Database.load('sqlite:privacyscribe.db')
  return _db
}

/**
 * Creates the notes table if it doesn't already exist.
 * Safe to call on every app start — uses IF NOT EXISTS.
 */
export async function initDb(): Promise<void> {
  const db = await getDb()

  await db.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id            TEXT PRIMARY KEY NOT NULL,
      title         TEXT NOT NULL DEFAULT '',
      subjective    TEXT NOT NULL DEFAULT '',
      objective     TEXT NOT NULL DEFAULT '',
      assessment    TEXT NOT NULL DEFAULT '',
      plan          TEXT NOT NULL DEFAULT '',
      transcription TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `)

  logger.info('Database initialised')
}

/**
 * Row shape returned by SELECT queries on the notes table.
 * Column names match SQLite snake_case; the store maps them to camelCase.
 */
export interface NoteRow {
  id: string
  title: string
  subjective: string
  objective: string
  assessment: string
  plan: string
  transcription: string
  created_at: number
  updated_at: number
}
