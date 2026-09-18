import pg from "pg";
const {Pool}=pg;
const globalForDb=globalThis;
export const db=globalForDb.__gemPool || new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes("localhost")?false:{rejectUnauthorized:false}});
if(process.env.NODE_ENV!=="production") globalForDb.__gemPool=db;

export async function ensureSchema(){
 await db.query(`
 CREATE TABLE IF NOT EXISTS offices(
  id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL
 );
 CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('PCM','INSPECTOR')),
  office_id INTEGER REFERENCES offices(id), active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE TABLE IF NOT EXISTS inspections(
  id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), inspection_date DATE NOT NULL,
  office_id INTEGER NOT NULL REFERENCES offices(id), user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL, plan_no TEXT, order_no TEXT, location TEXT NOT NULL,
  equipment_no TEXT NOT NULL, operation TEXT NOT NULL, suboperation TEXT,
  description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Concluído'
 );
 CREATE TABLE IF NOT EXISTS inspection_revisions(
  id BIGSERIAL PRIMARY KEY, inspection_id BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), old_description TEXT NOT NULL,
  new_description TEXT NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );`);
}