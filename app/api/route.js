/**
 * SF Stock API (Next.js) — แทน api.php
 * เรียกแบบเดิม: /api?action=read, /api?action=update (POST) ฯลฯ
 * ปิดระบบล็อกอิน: ทุกคำขอถือเป็นผู้ใช้เริ่มต้น (ดู DEFAULT_NICKNAME / DEFAULT_ROLE)
 */
import crypto from 'node:crypto';
import { sql } from '../../lib/db.mjs';
import { ensureSchemaOnce } from '../../lib/schema.mjs';
import { SF_ZONES, SF_FIELDS, TZ } from '../../lib/constants.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* ---------- ตัวช่วย ---------- */
class ApiError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const fail = (msg, status = 400) => { throw new ApiError(msg, status); };

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });

function strIn(b, k, max, required = true) {
  const v = String(b?.[k] ?? '').trim();
  if (required && v === '') fail(`กรุณาระบุ ${k}`);
  if ([...v].length > max) fail(`${k} ยาวเกิน ${max} ตัวอักษร`);
  return v;
}
function numIn(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean' || Number.isNaN(Number(v))) fail('ค่าต้องเป็นตัวเลข');
  const f = Number(v);
  if (!Number.isFinite(f) || f < 0 || f > 10000000) fail('ตัวเลขอยู่นอกช่วงที่รับได้ (0 – 10,000,000)');
  return Math.round(f * 10000) / 10000;
}
const requirePost = (req) => { if (req.method !== 'POST') fail('ต้องใช้ POST', 405); };

function clientIp(req) {
  const xf = req.headers.get('x-forwarded-for') || '';
  return (xf.split(',')[0].trim() || req.headers.get('x-real-ip') || '-').slice(0, 45);
}
function currentUser() {
  const role = process.env.DEFAULT_ROLE === 'staff' ? 'staff' : 'admin';
  return { nickname: process.env.DEFAULT_NICKNAME || 'ผู้ใช้', role };
}
const todayBangkok = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

const TS_FMT = `'YYYY-MM-DD HH24:MI:SS'`;

/* ---------- ประวัติการแก้ไข ---------- */
async function audit(q, who, ip, action, productId = null, productName = null, field = null, oldV = null, newV = null) {
  const toStr = (v) => (v === null || v === undefined ? null : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  await q`insert into sf_audit_log (at, nickname, role, action, product_id, product_name, field, old_value, new_value, ip)
          values (now(), ${who.nickname.slice(0, 40)}, ${who.role}, ${action}, ${productId}, ${productName}, ${field}, ${toStr(oldV)}, ${toStr(newV)}, ${ip})`;
}

/* ---------- ดึงสินค้าทั้งหมดในรูปแบบที่หน้าเว็บใช้ ---------- */
async function buildGroups(q) {
  const conf = {};
  const cr = await q`select product_id, zone, confirmed_by,
                     to_char(confirmed_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI:SS') as confirmed_at
                     from sf_confirmations`;
  for (const c of cr) (conf[c.product_id] ||= {})[c.zone] = { by: c.confirmed_by, at: c.confirmed_at };

  const groups = new Map();
  const rows = await q`select * from products order by group_name, id`;
  for (const r of rows) {
    const g = r.group_name;
    if (!groups.has(g)) groups.set(g, { id: crypto.createHash('md5').update(g).digest('hex'), name: g, items: [] });
    const n = (v) => Number(v ?? 0);
    groups.get(g).items.push({
      id: r.id,
      name: r.name,
      sku: r.sku,
      unitPerBox: n(r.unit_per_box),
      zones: {
        back: { boxQty: n(r.back_box), pieceQty: n(r.back_piece) },
        front: { m1: n(r.front_1), m2: n(r.front_2), m3: n(r.front_3), show: n(r.front_show) },
      },
      fg_open: n(r.fg_open),
      fg_add: n(r.fg_add),
      c3: n(r.c3), daily: n(r.daily), office: n(r.office), booth: n(r.booth), main: n(r.main),
      show: !!r.is_show,
      confirmedZones: conf[r.id] || {},
    });
  }
  return [...groups.values()];
}

/* ---------- คำสั่งต่าง ๆ ---------- */
const actions = {
  async ping() {
    return { status: 'success', time: new Date().toISOString() };
  },

  async me({ user }) {
    return { status: 'success', nickname: user.nickname, role: user.role };
  },

  async read({ db }) {
    return { status: 'success', groups: await buildGroups(db), server_time: new Date().toISOString() };
  },

  async update({ req, db, user, ip, body }) {
    requirePost(req);
    const field = String(body.field ?? '');
    if (!Object.hasOwn(SF_FIELDS, field)) fail('Invalid field');
    const col = SF_FIELDS[field];
    const val = numIn(body.value);
    if (field === 'unit_per_box' && val <= 0) fail('จำนวนต่อลังต้องมากกว่า 0');
    const id = String(body.id ?? '');
    await db.begin(async (tx) => {
      // col มาจากรายการที่อนุญาตเท่านั้น (SF_FIELDS) จึงใส่ในคำสั่งได้อย่างปลอดภัย
      const rows = await tx.unsafe(`select name, "${col}" as v from products where id = $1 for update`, [id]);
      if (!rows.length) fail('ไม่พบสินค้า (อาจถูกลบไปแล้ว)', 404);
      const old = Number(rows[0].v);
      if (Math.abs(old - val) > 0.00005) {
        await tx.unsafe(`update products set "${col}" = $1 where id = $2`, [val, id]);
        await audit(tx, user, ip, 'update', id, rows[0].name, field, old, val);
      }
    });
    return { status: 'success', value: val };
  },

  async confirm({ req, db, user, ip, body }) {
    requirePost(req);
    const id = String(body.id ?? '');
    const zone = String(body.zone ?? '');
    if (!SF_ZONES.includes(zone)) fail('Invalid zone');
    const p = (await db`select name from products where id = ${id}`)[0];
    if (!p) fail('ไม่พบสินค้า (อาจถูกลบไปแล้ว)', 404);
    if (body.value) {
      await db`insert into sf_confirmations (product_id, zone, confirmed_by, confirmed_at)
               values (${id}, ${zone}, ${user.nickname.slice(0, 40)}, now())
               on conflict (product_id, zone) do update
               set confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at`;
      await audit(db, user, ip, 'confirm', id, p.name, zone, 0, 1);
    } else {
      await db`delete from sf_confirmations where product_id = ${id} and zone = ${zone}`;
      await audit(db, user, ip, 'unconfirm', id, p.name, zone, 1, 0);
    }
    return { status: 'success' };
  },

  async save_history({ req, db, user, ip }) {
    requirePost(req);
    const date = todayBangkok();
    const reset = await db.begin(async (tx) => {
      const data = JSON.stringify(await buildGroups(tx));
      await tx`insert into stock_history (record_date, json_data) values (${date}, ${data})
               on conflict (record_date) do update set json_data = excluded.json_data`;
      const n = Number((await tx`select count(*) as n from sf_confirmations`)[0].n);
      await tx`delete from sf_confirmations`;
      await audit(tx, user, ip, 'save_history', null, null, null, null, `${date} (รีเซ็ตยืนยัน ${n} รายการ)`);
      return n;
    });
    return { status: 'success', date, reset };
  },

  async get_history_list({ db }) {
    const list = await db`select id, to_char(record_date, 'YYYY-MM-DD') as record_date,
                          to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI:SS') as created_at
                          from stock_history order by record_date desc`;
    return { status: 'success', list };
  },

  async get_history_detail({ db, url }) {
    const id = Number(url.searchParams.get('id') || 0) || 0;
    const row = (await db`select to_char(record_date, 'YYYY-MM-DD') as record_date, json_data
                          from stock_history where id = ${id}`)[0];
    if (!row) fail('ไม่พบประวัติ', 404);
    return { status: 'success', data: JSON.parse(row.json_data), date: row.record_date };
  },

  async update_history_record({ req, db, user, ip, body }) {
    requirePost(req);
    const id = Number(body.id ?? 0) || 0;
    if (!Array.isArray(body.groups)) fail('ข้อมูลไม่ถูกต้อง');
    await db`update stock_history set json_data = ${JSON.stringify(body.groups)} where id = ${id}`;
    await audit(db, user, ip, 'edit_history', null, null, null, null, `history#${id}`);
    return { status: 'success' };
  },

  async get_dashboard_data({ db }) {
    const rows = await db`select to_char(record_date, 'YYYY-MM-DD') as record_date, json_data
                          from stock_history order by record_date desc limit 7`;
    return { status: 'success', history: rows.map((r) => ({ date: r.record_date, data: JSON.parse(r.json_data) })) };
  },

  async create({ req, db, user, ip, body }) {
    requirePost(req);
    const id = String(body.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail('รหัสสินค้าไม่ถูกต้อง');
    const group = strIn(body, 'group_name', 190);
    const name = strIn(body, 'name', 250);
    const sku = strIn(body, 'sku', 64, false) || '-';
    const unit = numIn(body.unit_per_box ?? 1);
    if (unit <= 0) fail('จำนวนต่อลังต้องมากกว่า 0');
    if (sku !== '-' && (await db`select id from products where sku = ${sku} limit 1`).length) fail('บาร์โค้ดนี้มีสินค้าอยู่แล้ว');
    if ((await db`select id from products where id = ${id}`).length) fail('รหัสสินค้าซ้ำ');
    await db`insert into products (id, group_name, name, sku, unit_per_box) values (${id}, ${group}, ${name}, ${sku}, ${unit})`;
    await audit(db, user, ip, 'create', id, name, null, null, { group, sku, unit_per_box: unit });
    return { status: 'success' };
  },

  async delete({ req, db, user, ip, body }) {
    requirePost(req);
    const id = String(body.id ?? '');
    const row = (await db`select * from products where id = ${id}`)[0];
    if (!row) fail('ไม่พบสินค้า', 404);
    await db.begin(async (tx) => {
      await tx`delete from sf_confirmations where product_id = ${id}`;
      await tx`delete from products where id = ${id}`;
      await audit(tx, user, ip, 'delete', id, row.name, null, row, null); // เก็บข้อมูลทั้งแถวไว้ เผื่อกู้คืน
    });
    return { status: 'success' };
  },

  async audit_log({ db, user, url }) {
    if (user.role !== 'admin') fail('ต้องใช้สิทธิ์แอดมิน', 403);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
    const before = Number(url.searchParams.get('before')) || 0;
    const search = (url.searchParams.get('q') || '').trim();
    const like = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
    const rows = await db`
      select id, to_char(at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI:SS') as at,
             nickname, role, action, product_id, product_name, field, old_value, new_value
      from sf_audit_log
      where true
        ${before > 0 ? db`and id < ${before}` : db``}
        ${search !== '' ? db`and (product_name ilike ${like} or nickname ilike ${like})` : db``}
      order by id desc
      limit ${limit}`;
    return { status: 'success', rows: rows.map((r) => ({ ...r, id: Number(r.id) })) };
  },

  /** สำรองข้อมูล: ดาวน์โหลดไฟล์ JSON ทุกตาราง (Vercel เก็บไฟล์ถาวรไม่ได้ จึงสร้างให้ตอนกดโหลด) */
  async backup_export({ db, user, ip }) {
    if (user.role !== 'admin') fail('ต้องใช้สิทธิ์แอดมิน', 403);
    const dump = {
      exported_at: new Date().toISOString(),
      products: await db`select * from products order by id`,
      stock_history: await db`select id, to_char(record_date, 'YYYY-MM-DD') as record_date, json_data, created_at from stock_history order by record_date`,
      sf_confirmations: await db`select * from sf_confirmations`,
      sf_audit_log: await db`select * from sf_audit_log order by id`,
    };
    await audit(db, user, ip, 'backup', null, null, null, null, 'export-json');
    const name = `sf-stock-${todayBangkok().replaceAll('-', '')}.json`;
    return new Response(JSON.stringify(dump), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  },
};

/* ---------- ตัวรับคำขอ ---------- */
async function handle(req) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';
    if (!Object.hasOwn(actions, action)) fail('Unknown action', 404);

    if (action === 'ping') return json(await actions.ping());

    const db = sql();
    await ensureSchemaOnce();

    let body = {};
    if (req.method === 'POST') {
      const parsed = await req.json().catch(() => ({}));
      body = parsed && typeof parsed === 'object' ? parsed : {};
    }
    const result = await actions[action]({ req, url, db, body, user: currentUser(), ip: clientIp(req) });
    return result instanceof Response ? result : json(result);
  } catch (e) {
    if (e instanceof ApiError) return json({ status: 'error', msg: e.message }, e.status);
    if (e?.status === 503) return json({ status: 'error', msg: e.message }, 503);
    console.error('[sf-stock]', e);
    return json({ status: 'error', msg: 'เซิร์ฟเวอร์ผิดพลาด กรุณาลองใหม่' }, 500);
  }
}

export const GET = handle;
export const POST = handle;
