import {jsonResponse,routeError} from '@/lib/account-route';
import {watchClubContext} from '@/lib/watch-clubs-route';
import {MembershipError,readJsonMutation} from '@/lib/membership.mjs';
export const dynamic='force-dynamic';
export async function GET(){try{const {identity,service}=await watchClubContext();return jsonResponse(await service.list(identity));}catch(e){return routeError(e);}}
export async function POST(request:Request){try{const p=await readJsonMutation(request,4096),{identity,service}=await watchClubContext();if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['action','title','token'].includes(k)))throw new MembershipError(400,'invalid_payload','Geçersiz işlem.');
 if(p.action==='create'&&!('token' in p))return jsonResponse(await service.create(identity,{title:p.title}),201);
 if(p.action==='join'&&!('title' in p))return jsonResponse(await service.join(identity,{token:p.token}));
 throw new MembershipError(400,'invalid_payload','Geçersiz işlem.');}catch(e){return routeError(e);}}
