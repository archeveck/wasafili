import { DatabaseSync } from 'node:sqlite';
import { type SqlDatabase, type SqlValue } from '../db.js';

/** Adaptateur `node:sqlite` pour les tests (même SQLite que sur mobile, FTS5 compris). */
export function openNodeDatabase(path = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params: readonly SqlValue[] = []) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),
    all: <T>(sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
    transaction: <T>(fn: () => T): T => {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
