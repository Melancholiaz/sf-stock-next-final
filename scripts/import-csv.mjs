/**
 * ย้ายข้อมูลเก่าจาก MySQL (phpMyAdmin → Export เป็น CSV) เข้า Postgres
 *
 * วิธีใช้:
 *   1) ใน phpMyAdmin เลือกตาราง products แล้ว Export รูปแบบ CSV (ติ๊ก "Put columns names in the first row")
 *      ทำเหมือนกันกับ stock_history แล้วตั้งชื่อไฟล์เป็น products.csv และ stock_history.csv
 *   2) วางสองไฟล์ไว้ในโฟลเดอร์ใดก็ได้ เช่น ./old-data
 *   3) รัน:  DATABASE_URL="postgresql://..." node scripts/import-csv.mjs ./old-data
 *
 * รันซ้ำได้ ไม่ทำให้ข้อมูลซ้ำ (สินค้าที่มี id เดิมจะถูกอัปเดตค่า)
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { sql } from '../lib/db.mjs';
import { ensureSchema } from '../lib/schema.mjs';

const dir = process.argv[2] || '.';
const db = sql();

const PRODUCT_TEXT = ['group_name', 'name', 'sku'];
const PRODUCT_NUM = ['unit_per_box', 'back_box', 'back_piece', 'front_1', 'front_2', 'front_3', 'front_show',
  'fg_open', 'fg_add', 'c3', 'daily', 'office', 'booth', 'main'];

function readCsv(file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return null;
  return parse(fs.readFileSync(p, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
}
const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};
const isNull = (v) => v === undefined || v === null || String(v).toUpperCase() === 'NULL';

await ensureSchema(db);

const products = readCsv('products.csv');
if (products) {
  let n = 0;
  for (const r of products) {
    if (!r.id) continue;
    const row = {
      id: String(r.id).trim(),
      group_name: isNull(r.group_name) ? '' : r.group_name,
      name: isNull(r.name) ? '' : r.name,
      sku: isNull(r.sku) || r.sku === '' ? '-' : r.sku,
      is_show: String(r.is_show) === '1',
    };
    for (const c of PRODUCT_NUM) row[c] = c === 'unit_per_box' ? (num(r[c]) || 1) : num(r[c]);
    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const updates = cols.filter((c) => c !== 'id').map((c) => `"${c}" = excluded."${c}"`).join(', ');
    await db.unsafe(
      `insert into products (${cols.map((c) => `"${c}"`).join(',')}) values (${placeholders})
       on conflict (id) do update set ${updates}`,
      cols.map((c) => row[c]),
    );
    n++;
  }
  console.log(`products: นำเข้า ${n} รายการ`);
} else {
  console.log('ไม่พบ products.csv — ข้ามตารางสินค้า');
}

const history = readCsv('stock_history.csv');
if (history) {
  let n = 0;
  for (const r of history) {
    if (!r.record_date || isNull(r.json_data)) continue;
    const date = String(r.record_date).slice(0, 10);
    await db`insert into stock_history (record_date, json_data) values (${date}, ${r.json_data})
             on conflict (record_date) do update set json_data = excluded.json_data`;
    n++;
  }
  console.log(`stock_history: นำเข้า ${n} วัน`);
} else {
  console.log('ไม่พบ stock_history.csv — ข้ามประวัติรายวัน');
}

await db.end();
console.log('เสร็จแล้ว');
