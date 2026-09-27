import { createSqliteRepo } from './sqlite/index.js';

/**
 * Chooses the storage adapter. To add PostgreSQL: create repo/postgres/index.js exporting createPostgresRepo()
 * with the same methods as the SQLite adapter (see README.md), then select it here via DATABASE_URL.
 */
export function createRepo(config) {
  if (process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is set but no PostgreSQL adapter is installed yet. See server/repo/README.md.');
  }
  return createSqliteRepo({ path: config.dbPath });
}
