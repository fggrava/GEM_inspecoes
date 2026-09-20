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
  equipment_no TEXT NOT NULL, operation TEXT, suboperation TEXT,
  description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Concluído',
  needs_part BOOLEAN, part_description TEXT, stock_status TEXT, part_code TEXT,
  suboperation_count INTEGER, client_record_id TEXT
 );
 ALTER TABLE inspections ALTER COLUMN operation DROP NOT NULL;
 ALTER TABLE inspections ADD COLUMN IF NOT EXISTS needs_part BOOLEAN;
 ALTER TABLE inspections ADD COLUMN IF NOT EXISTS part_description TEXT;
 ALTER TABLE inspections ADD COLUMN IF NOT EXISTS stock_status TEXT;
 ALTER TABLE inspections ADD COLUMN IF NOT EXISTS part_code TEXT;
 ALTER TABLE inspections ADD COLUMN IF NOT EXISTS suboperation_count INTEGER;
 ALTER TABLE inspections ADD COLUMN IF NOT EXISTS client_record_id TEXT;
 CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_client_record_id ON inspections(client_record_id);
 CREATE TABLE IF NOT EXISTS inspection_suboperations(
  id BIGSERIAL PRIMARY KEY,
  inspection_id BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  description TEXT NOT NULL,
  UNIQUE(inspection_id,sequence)
 );
 CREATE INDEX IF NOT EXISTS idx_inspection_suboperations_inspection ON inspection_suboperations(inspection_id);
 CREATE TABLE IF NOT EXISTS inspection_revisions(
  id BIGSERIAL PRIMARY KEY, inspection_id BIGINT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), old_description TEXT NOT NULL,
  new_description TEXT NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );`);
}
