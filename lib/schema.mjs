import { sql } from './db.mjs';

const NUM = 'numeric(14,4) not null default 0';

export const SCHEMA_STATEMENTS = [
  `create table if not exists products (
    id varchar(64) primary key,
    group_name varchar(191) not null default '',
    name varchar(255) not null default '',
    sku varchar(64) not null default '-',
    unit_per_box numeric(14,4) not null default 1,
    back_box ${NUM}, back_piece ${NUM},
    front_1 ${NUM}, front_2 ${NUM}, front_3 ${NUM}, front_show ${NUM},
    fg_open ${NUM}, fg_add ${NUM},
    c3 ${NUM}, daily ${NUM}, office ${NUM}, booth ${NUM}, main ${NUM},
    is_show boolean not null default false,
    confirmed boolean not null default false
  )`,
  `create table if not exists stock_history (
    id serial primary key,
    record_date date not null unique,
    json_data text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists sf_confirmations (
    product_id varchar(64) not null,
    zone varchar(20) not null,
    confirmed_by varchar(40) not null,
    confirmed_at timestamptz not null default now(),
    primary key (product_id, zone)
  )`,
  `create table if not exists sf_audit_log (
    id bigserial primary key,
    at timestamptz not null default now(),
    nickname varchar(40) not null,
    role varchar(10) not null,
    action varchar(30) not null,
    product_id varchar(64),
    product_name varchar(255),
    field varchar(30),
    old_value text,
    new_value text,
    ip varchar(45) not null default ''
  )`,
  `create index if not exists idx_audit_at on sf_audit_log (at)`,
  `create index if not exists idx_audit_product on sf_audit_log (product_id)`,
];

/** สร้างตารางถ้ายังไม่มี (ทำครั้งเดียวต่อ instance) */
export async function ensureSchema(db = sql()) {
  for (const stmt of SCHEMA_STATEMENTS) await db.unsafe(stmt);
}

let ready = null;
export function ensureSchemaOnce() {
  if (!ready) ready = ensureSchema().catch((e) => { ready = null; throw e; });
  return ready;
}
