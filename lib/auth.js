import {SignJWT,jwtVerify} from "jose";
import {cookies} from "next/headers";
const key=()=>new TextEncoder().encode(process.env.AUTH_SECRET||"dev-only-change-me");
export async function makeToken(user){return new SignJWT({id:user.id,role:user.role,office_id:user.office_id,name:user.name,email:user.email}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h").sign(key())}
export async function session(){
 const c=await cookies(); const t=c.get("gem_session")?.value; if(!t)return null;
 try{return (await jwtVerify(t,key())).payload}catch{return null}
}
export async function requireUser(){const s=await session();if(!s)throw new Error("UNAUTHORIZED");return s}