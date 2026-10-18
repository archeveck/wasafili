import { type Pool, type PoolClient } from 'pg';

/** Transaction dans le contexte RLS d'une instance (même isolation que l'API). */
export async function inInstance<T>(
  db: Pool,
  instanceId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.instance_id', $1, true)", [instanceId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
