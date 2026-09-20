import {NextResponse} from "next/server";
import {db,ensureSchema} from "../../../lib/db";
import {requireUser} from "../../../lib/auth";

export async function GET(req){
 try{
  await ensureSchema();
  const u=await requireUser();
  const url=new URL(req.url);
  const search=url.searchParams.get("q")||"";
  let args=[`%${search}%`],where=`AND (i.equipment_no ILIKE $1 OR i.location ILIKE $1 OR COALESCE(i.order_no,'') ILIKE $1)`;
  if(u.role==="INSPECTOR"){args.push(u.office_id);where+=` AND i.office_id=$2`}
  const q=await db.query(`SELECT i.*,o.name office,u.name inspector,
    COALESCE((SELECT json_agg(json_build_object('sequence',s.sequence,'description',s.description) ORDER BY s.sequence) FROM inspection_suboperations s WHERE s.inspection_id=i.id),'[]'::json) suboperations
    FROM inspections i JOIN offices o ON o.id=i.office_id JOIN users u ON u.id=i.user_id WHERE 1=1 ${where} ORDER BY i.created_at DESC LIMIT 500`,args);
  return NextResponse.json(q.rows);
 }catch(e){return NextResponse.json({error:e.message},{status:e.message==="UNAUTHORIZED"?401:500})}
}

export async function POST(req){
 const client=await db.connect();
 try{
  await ensureSchema();
  const u=await requireUser();
  if(u.role!=="INSPECTOR")return NextResponse.json({error:"Perfil PCM não realiza lançamentos"},{status:403});
  const x=await req.json();
  const clientRecordId=String(x.client_record_id||"").trim()||null;

  if(clientRecordId){
   const existing=await client.query("SELECT * FROM inspections WHERE client_record_id=$1",[clientRecordId]);
   if(existing.rows[0])return NextResponse.json({...existing.rows[0],duplicate:true},{status:200});
  }

  const isRevision=x.reason==="Revisão de Plano";
  const isInspection=x.reason==="Inspeção";
  if(!isRevision&&!isInspection)return NextResponse.json({error:"Motivo inválido."},{status:400});

  let operation=null,suboperationCount=null,suboperations=[];
  let needsPart=null,partDescription=null,stockStatus=null,partCode=null;

  if(isRevision){
   operation=String(x.operation||"").trim();
   suboperationCount=Number(x.suboperation_count||0);
   suboperations=Array.isArray(x.suboperations)?x.suboperations:[];
   if(!operation)return NextResponse.json({error:"Informe a operação."},{status:400});
   if(!Number.isInteger(suboperationCount)||suboperationCount<1||suboperationCount>50)return NextResponse.json({error:"Informe uma quantidade de sub-operações entre 1 e 50."},{status:400});
   if(suboperations.length!==suboperationCount)return NextResponse.json({error:"Preencha todas as descrições das sub-operações."},{status:400});
   if(suboperations.some(v=>!String(v||"").trim()))return NextResponse.json({error:"Todas as sub-operações precisam de uma descrição."},{status:400});
  }

  if(isInspection){
   needsPart=Boolean(x.needs_part);
   if(needsPart){
    partDescription=String(x.part_description||"").trim();
    stockStatus=String(x.stock_status||"").trim();
    partCode=String(x.part_code||"").trim()||null;
    if(!partDescription)return NextResponse.json({error:"Informe a descrição da peça."},{status:400});
    if(!["Possui","Não possui","Sem cadastro"].includes(stockStatus))return NextResponse.json({error:"Informe o status no almoxarifado."},{status:400});
    if(stockStatus==="Sem cadastro")partCode=null;
    else if(!partCode)return NextResponse.json({error:"Informe o código da peça ou selecione Sem cadastro."},{status:400});
   }
  }

  await client.query("BEGIN");
  const q=await client.query(`INSERT INTO inspections(
    inspection_date,office_id,user_id,reason,plan_no,order_no,location,equipment_no,operation,suboperation,description,
    needs_part,part_description,stock_status,part_code,suboperation_count,client_record_id
   ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[
    x.inspection_date,u.office_id,u.id,x.reason,x.plan_no||null,x.order_no||null,x.location,x.equipment_no,operation,x.description,
    needsPart,partDescription,stockStatus,partCode,suboperationCount,clientRecordId
  ]);
  const inspection=q.rows[0];
  if(isRevision){
   for(let i=0;i<suboperations.length;i++){
    await client.query("INSERT INTO inspection_suboperations(inspection_id,sequence,description) VALUES($1,$2,$3)",[inspection.id,i+1,String(suboperations[i]).trim()]);
   }
  }
  await client.query("COMMIT");
  return NextResponse.json(inspection,{status:201});
 }catch(e){
  try{await client.query("ROLLBACK")}catch{}
  if(e.code==="23505"&&String(e.constraint||"").includes("client_record")){
   const body=await req.clone().json().catch(()=>({}));
   const existing=await db.query("SELECT * FROM inspections WHERE client_record_id=$1",[body.client_record_id]);
   if(existing.rows[0])return NextResponse.json({...existing.rows[0],duplicate:true},{status:200});
  }
  return NextResponse.json({error:e.message},{status:e.message==="UNAUTHORIZED"?401:500});
 }finally{client.release()}
}

export async function PATCH(req){
 const client=await db.connect();
 try{
  await ensureSchema();
  const u=await requireUser();
  const x=await req.json();
  const old=await client.query("SELECT * FROM inspections WHERE id=$1",[x.id]);
  if(!old.rows[0])return NextResponse.json({error:"Registro não encontrado"},{status:404});
  if(u.role==="INSPECTOR"&&Number(old.rows[0].office_id)!==Number(u.office_id))return NextResponse.json({error:"Sem permissão"},{status:403});
  await client.query("BEGIN");
  await client.query("INSERT INTO inspection_revisions(inspection_id,user_id,old_description,new_description) VALUES($1,$2,$3,$4)",[x.id,u.id,old.rows[0].description,x.description]);
  await client.query("UPDATE inspections SET description=$1,updated_at=NOW() WHERE id=$2",[x.description,x.id]);
  await client.query("COMMIT");
  return NextResponse.json({ok:true});
 }catch(e){
  try{await client.query("ROLLBACK")}catch{}
  return NextResponse.json({error:e.message},{status:e.message==="UNAUTHORIZED"?401:500});
 }finally{client.release()}
}

export async function DELETE(req){
 try{
  await ensureSchema();
  const u=await requireUser();
  if(u.role!=="PCM")return NextResponse.json({error:"Apenas o PCM pode excluir registros do histórico."},{status:403});
  const x=await req.json();
  const id=Number(x.id);
  if(!id)return NextResponse.json({error:"Registro inválido."},{status:400});
  const current=await db.query("SELECT id FROM inspections WHERE id=$1",[id]);
  if(!current.rows[0])return NextResponse.json({error:"Registro não encontrado."},{status:404});
  await db.query("DELETE FROM inspections WHERE id=$1",[id]);
  return NextResponse.json({ok:true});
 }catch(e){
  const status=e.message==="UNAUTHORIZED"?401:500;
  return NextResponse.json({error:e.message},{status});
 }
}
