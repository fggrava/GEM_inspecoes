import {NextResponse} from "next/server";import bcrypt from "bcryptjs";import {db,ensureSchema} from "../../../lib/db";
export async function POST(req){
 if(req.headers.get("x-bootstrap-secret")!==process.env.BOOTSTRAP_SECRET)return NextResponse.json({error:"Não autorizado"},{status:401});
 await ensureSchema();
 const offices=["Elétrica","Mecânica","Mecânica de Embalagem","Utilidades","Silos","Predial"];
 for(const name of offices)await db.query("INSERT INTO offices(name) VALUES($1) ON CONFLICT(name) DO NOTHING",[name]);
 const pcm=await bcrypt.hash("GEM@2026",10), insp=await bcrypt.hash("GEM@2026",10);
 await db.query(`INSERT INTO users(name,email,password_hash,role) VALUES('PCM GEM','pcm@gem.local',$1,'PCM') ON CONFLICT(email) DO NOTHING`,[pcm]);
 const o=await db.query("SELECT id FROM offices WHERE name='Elétrica'");
 await db.query(`INSERT INTO users(name,email,password_hash,role,office_id) VALUES('Inspetor Elétrica','inspetor@gem.local',$1,'INSPECTOR',$2) ON CONFLICT(email) DO NOTHING`,[insp,o.rows[0].id]);
 return NextResponse.json({ok:true,users:["pcm@gem.local","inspetor@gem.local"],temporaryPassword:"GEM@2026"});
}