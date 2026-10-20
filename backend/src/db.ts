import { Pool } from 'pg';

// Prisma-friendly URL includes ?schema=public, which `pg` doesn't need.
const connectionString = (process.env.DATABASE_URL || '').replace(
  /([?&])schema=[^&]*&?/,
  '$1',
).replace(/[?&]$/, '');

if (!connectionString) {
  console.error('[db] DATABASE_URL is not set');
  process.exit(1);
}

export const pool = new Pool({ connectionString });

export async function checkDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
