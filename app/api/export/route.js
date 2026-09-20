import {NextResponse} from "next/server";
import * as XLSX from "xlsx";
import {db,ensureSchema} from "../../../lib/db";
import {requireUser} from "../../../lib/auth";

export const runtime = "nodejs";

export async function GET(){
  try{
    await ensureSchema();
    const u=await requireUser();

    let args=[];
    let where="";
    if(u.role==="INSPECTOR"){
      args=[u.office_id];
      where="WHERE i.office_id=$1";
    }

    const q=await db.query(`
      SELECT
        i.inspection_date "Data",
        o.name "Oficina",
        i.reason "Motivo",
        i.plan_no "Nº Plano",
        i.order_no "Nº Ordem",
        i.location "Local/Linha",
        i.equipment_no "Nº Equipamento",
        i.operation "Operação",
        i.suboperation "Sub-operação",
        i.description "Descrição",
        i.status "Status",
        usr.name "Inspetor"
      FROM inspections i
      JOIN offices o ON o.id=i.office_id
      JOIN users usr ON usr.id=i.user_id
      ${where}
      ORDER BY i.inspection_date DESC, i.id DESC
    `,args);

    const rows=q.rows.map(r=>({
      ...r,
      Data:r.Data instanceof Date ? r.Data.toISOString().slice(0,10) : String(r.Data||"").slice(0,10)
    }));

    const wb=XLSX.utils.book_new();
    const ws=rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["Data","Oficina","Motivo","Nº Plano","Nº Ordem","Local/Linha","Nº Equipamento","Operação","Sub-operação","Descrição","Status","Inspetor"]]);

    ws["!cols"]=[
      {wch:12},{wch:24},{wch:20},{wch:14},{wch:14},{wch:24},
      {wch:18},{wch:24},{wch:24},{wch:60},{wch:14},{wch:24}
    ];

    XLSX.utils.book_append_sheet(wb,ws,"Inspeções");
    const buf=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});

    const suffix=u.role==="INSPECTOR"?"Oficina":"Consolidado";
    return new NextResponse(buf,{
      status:200,
      headers:{
        "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":`attachment; filename="GEM_Inspecoes_${suffix}.xlsx"`,
        "Cache-Control":"no-store"
      }
    });
  }catch(e){
    console.error("Erro na exportação XLSX:",e);
    const status=e.message==="UNAUTHORIZED"?401:500;
    return NextResponse.json({error:e.message||"Erro ao gerar arquivo Excel."},{status});
  }
}
