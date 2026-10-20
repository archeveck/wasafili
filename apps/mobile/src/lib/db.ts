import { type SqlDatabase } from '@wasafili/sync';
import { openDatabaseSync } from 'expo-sqlite';

/** Base SQLite de l'appareil (FTS5 activé par défaut dans expo-sqlite). */
export function openDeviceDatabase(name = 'wasafili.db'): SqlDatabase {
  const db = openDatabaseSync(name);
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params = []) => ({ changes: db.runSync(sql, [...params]).changes }),
    all: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      db.getAllSync<T>(sql, [...params]),
    get: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      db.getFirstSync<T>(sql, [...params]) ?? undefined,
    transaction: <T>(fn: () => T): T => {
      let result!: T;
      db.withTransactionSync(() => {
        result = fn();
      });
      return result;
    },
  };
}
