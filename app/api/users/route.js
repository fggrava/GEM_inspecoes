import {NextResponse} from "next/server";
import bcrypt from "bcryptjs";
import {db,ensureSchema} from "../../../lib/db";
import {requireUser} from "../../../lib/auth";

async function requirePCM(){
  const user=await requireUser();
  if(user.role!=="PCM") throw new Error("FORBIDDEN");
  return user;
}

export async function GET(){
  try{
    await ensureSchema();
    await requirePCM();
    const [users,offices]=await Promise.all([
      db.query(`SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,u.office_id,o.name office
                FROM users u LEFT JOIN offices o ON o.id=u.office_id
                WHERE u.role='INSPECTOR'
                ORDER BY u.active DESC,o.name,u.name`),
      db.query(`SELECT id,name FROM offices ORDER BY id`)
    ]);
    return NextResponse.json({inspectors:users.rows,offices:offices.rows});
  }catch(e){
    const status=e.message==="UNAUTHORIZED"?401:e.message==="FORBIDDEN"?403:500;
    return NextResponse.json({error:status===403?"Apenas o PCM pode gerenciar inspetores.":e.message},{status});
  }
}

export async function POST(req){
  try{
    await ensureSchema();
    await requirePCM();
    const x=await req.json();
    const name=String(x.name||"").trim();
    const email=String(x.email||"").trim().toLowerCase();
    const password=String(x.password||"");
    const officeId=Number(x.office_id);
    if(name.length<3) return NextResponse.json({error:"Informe o nome do inspetor."},{status:400});
    if(!/^\S+@\S+$/.test(email)) return NextResponse.json({error:"Informe um usuário no formato nome@setor, por exemplo marcelo@inspetor."},{status:400});
    if(password.length<8) return NextResponse.json({error:"A senha deve ter pelo menos 8 caracteres."},{status:400});
    const office=await db.query("SELECT id FROM offices WHERE id=$1",[officeId]);
    if(!office.rows[0]) return NextResponse.json({error:"Oficina inválida."},{status:400});
    const hash=await bcrypt.hash(password,10);
    const q=await db.query(`INSERT INTO users(name,email,password_hash,role,office_id,active)
                            VALUES($1,$2,$3,'INSPECTOR',$4,true)
                            RETURNING id,name,email,office_id,active`,[name,email,hash,officeId]);
    return NextResponse.json(q.rows[0],{status:201});
  }catch(e){
    if(e.code==="23505") return NextResponse.json({error:"Já existe um usuário com este e-mail/identificador."},{status:409});
    const status=e.message==="UNAUTHORIZED"?401:e.message==="FORBIDDEN"?403:500;
    return NextResponse.json({error:e.message},{status});
  }
}

export async function PATCH(req){
  try{
    await ensureSchema();
    await requirePCM();
    const x=await req.json();
    const id=Number(x.id);
    const current=await db.query("SELECT id,role FROM users WHERE id=$1",[id]);
    if(!current.rows[0]||current.rows[0].role!=="INSPECTOR") return NextResponse.json({error:"Inspetor não encontrado."},{status:404});

    if(x.action==="password"){
      const password=String(x.password||"");
      if(password.length<8) return NextResponse.json({error:"A senha deve ter pelo menos 8 caracteres."},{status:400});
      const hash=await bcrypt.hash(password,10);
      await db.query("UPDATE users SET password_hash=$1 WHERE id=$2",[hash,id]);
      return NextResponse.json({ok:true});
    }

    if(x.action==="active"){
      await db.query("UPDATE users SET active=$1 WHERE id=$2",[Boolean(x.active),id]);
      return NextResponse.json({ok:true});
    }

    if(x.action==="profile"){
      const name=String(x.name||"").trim();
      const officeId=Number(x.office_id);
      if(name.length<3) return NextResponse.json({error:"Nome inválido."},{status:400});
      const office=await db.query("SELECT id FROM offices WHERE id=$1",[officeId]);
      if(!office.rows[0]) return NextResponse.json({error:"Oficina inválida."},{status:400});
      await db.query("UPDATE users SET name=$1,office_id=$2 WHERE id=$3",[name,officeId,id]);
      return NextResponse.json({ok:true});
    }

    return NextResponse.json({error:"Ação inválida."},{status:400});
  }catch(e){
    const status=e.message==="UNAUTHORIZED"?401:e.message==="FORBIDDEN"?403:500;
    return NextResponse.json({error:e.message},{status});
  }
}
