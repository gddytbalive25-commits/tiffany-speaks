import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';

let pool: Pool | null = null;

function makePool(): Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(raw);
  if (!['mysql:', 'mariadb:'].includes(url.protocol)) throw new Error('DATABASE_URL must use a MySQL-compatible protocol.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) throw new Error('DATABASE_URL is missing its host or database name.');
  return mysql.createPool({
    host: url.hostname,
    port: Number(url.port || '3306'),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 6,
    queueLimit: 0,
    connectTimeout: 10_000,
    charset: 'utf8mb4',
    dateStrings: true,
  });
}

export function getPool(): Pool {
  if (!pool) pool = makePool();
  return pool;
}

export async function initializeDatabase(): Promise<void> {
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS tiffany_schema_migrations (
    version varchar(80) NOT NULL PRIMARY KEY,
    applied_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS tiffany_guest_sessions (
    session_hash char(64) NOT NULL PRIMARY KEY,
    buyer_id char(36) NOT NULL UNIQUE,
    email varchar(320) NULL,
    created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS tiffany_orders (
    checkout_session_id varchar(255) NOT NULL PRIMARY KEY,
    buyer_id char(36) NOT NULL,
    plan varchar(24) NOT NULL,
    stripe_customer_id varchar(255) NULL,
    payment_intent_id varchar(255) NULL,
    subscription_id varchar(255) NULL,
    price_id varchar(255) NULL,
    amount_total bigint NULL,
    currency char(3) NULL,
    status varchar(40) NOT NULL,
    created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY tiffany_orders_buyer_created (buyer_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Keep the first-release table intact; it is copied forward below and is never overwritten.
  await db.query(`CREATE TABLE IF NOT EXISTS tiffany_entitlements (
    buyer_id char(36) NOT NULL PRIMARY KEY,
    plan varchar(24) NOT NULL,
    is_active tinyint(1) NOT NULL DEFAULT 0,
    stripe_customer_id varchar(255) NULL,
    subscription_id varchar(255) NULL,
    updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS tiffany_entitlement_grants (
    grant_id varchar(255) NOT NULL PRIMARY KEY,
    buyer_id char(36) NOT NULL,
    plan varchar(24) NOT NULL,
    is_active tinyint(1) NOT NULL DEFAULT 0,
    stripe_customer_id varchar(255) NULL,
    subscription_id varchar(255) NULL,
    last_event_created bigint NOT NULL DEFAULT 0,
    updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY tiffany_grants_buyer_active (buyer_id, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS tiffany_stripe_events (
    event_id varchar(255) NOT NULL PRIMARY KEY,
    event_type varchar(120) NOT NULL,
    processed_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`INSERT IGNORE INTO tiffany_entitlement_grants
    (grant_id, buyer_id, plan, is_active, stripe_customer_id, subscription_id, last_event_created, updated_at)
    SELECT
      CASE
        WHEN plan = 'subscription' AND subscription_id IS NOT NULL THEN CONCAT('subscription:', subscription_id)
        WHEN plan = 'one_time' THEN CONCAT('one_time:legacy:', buyer_id)
        ELSE CONCAT('legacy:', buyer_id)
      END,
      buyer_id, plan, is_active, stripe_customer_id, subscription_id, 0, updated_at
    FROM tiffany_entitlements`);
  await db.execute('INSERT IGNORE INTO tiffany_schema_migrations (version) VALUES (?)', ['001_core_billing_and_guest_sessions']);
  await db.execute('INSERT IGNORE INTO tiffany_schema_migrations (version) VALUES (?)', ['002_independent_entitlement_grants']);
}

export type Guest = { buyerId: string; email: string | null };

export async function findGuest(sessionHash: string): Promise<Guest | null> {
  const [rows] = await getPool().execute('SELECT buyer_id AS buyerId, email FROM tiffany_guest_sessions WHERE session_hash = ? LIMIT 1', [sessionHash]);
  const guest = (rows as (RowDataPacket & Guest)[])[0];
  return guest ? { buyerId: guest.buyerId, email: guest.email } : null;
}

export async function createGuest(): Promise<{ guest: Guest; token: string; hash: string }> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const guest = { buyerId: randomUUID(), email: null };
  await getPool().execute('INSERT INTO tiffany_guest_sessions (session_hash, buyer_id) VALUES (?, ?)', [hash, guest.buyerId]);
  return { guest, token, hash };
}

export async function saveGuestEmail(buyerId: string, email: string): Promise<void> {
  await getPool().execute('UPDATE tiffany_guest_sessions SET email = ? WHERE buyer_id = ?', [email, buyerId]);
}

export async function hasPlus(buyerId: string): Promise<boolean> {
  const [rows] = await getPool().execute('SELECT grant_id FROM tiffany_entitlement_grants WHERE buyer_id = ? AND is_active = 1 LIMIT 1', [buyerId]);
  return (rows as RowDataPacket[]).length > 0;
}

export async function listOrders(buyerId: string): Promise<Array<{ id: string; plan: string; status: string; amount: number | null; currency: string | null; createdAt: string }>> {
  const [rows] = await getPool().execute(
    'SELECT checkout_session_id AS id, plan, status, amount_total AS amount, currency, created_at AS createdAt FROM tiffany_orders WHERE buyer_id = ? ORDER BY created_at DESC LIMIT 50',
    [buyerId],
  );
  return (rows as (RowDataPacket & { id: string; plan: string; status: string; amount: number | string | null; currency: string | null; createdAt: string })[]).map((row) => ({
    id: row.id,
    plan: row.plan,
    status: row.status,
    amount: row.amount === null ? null : Number(row.amount),
    currency: row.currency,
    createdAt: row.createdAt,
  }));
}

export async function closeDatabase(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}
