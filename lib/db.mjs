import postgres from 'postgres';

/**
 * เชื่อมต่อ Postgres (Neon / Supabase / ฯลฯ) ผ่านตัวแปร DATABASE_URL
 * - max: 1 และ prepare: false เหมาะกับ serverless และ connection pooler
 */
export function sql() {
  const g = globalThis;
  if (g.__sfSql) return g.__sfSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    const e = new Error('ยังไม่ได้ตั้งค่า DATABASE_URL');
    e.status = 503;
    throw e;
  }
  g.__sfSql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return g.__sfSql;
}
