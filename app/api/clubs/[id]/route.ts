import {jsonResponse,routeError} from '@/lib/account-route';
import {watchClubContext} from '@/lib/watch-clubs-route';
import {MembershipError,readJsonMutation} from '@/lib/membership.mjs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{const {id}=await context.params,{identity,service}=await watchClubContext();return jsonResponse(await service.get(identity,id));}catch(e){return routeError(e);}}
export async function POST(request:Request,context:Context){try{const p=await readJsonMutation(request,4096),{id}=await context.params,{identity,service}=await watchClubContext();if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['action','item','animeId'].includes(k)))throw new MembershipError(400,'invalid_payload','Geçersiz işlem.');
 if(p.action==='add'&&!('animeId' in p))return jsonResponse(await service.add(identity,id,p.item));
 if(['remove','vote'].includes(p.action)&&!('item' in p))return jsonResponse(await service[p.action as 'vote'|'remove'](identity,id,p.animeId));
 if(!('item' in p)&&!('animeId' in p)){if(p.action==='invite')return jsonResponse(await service.invite(identity,id));if(p.action==='leave')return jsonResponse(await service.leave(identity,id));if(p.action==='delete')return jsonResponse(await service.delete(identity,id));}
 throw new MembershipError(400,'invalid_payload','Geçersiz işlem.');}catch(e){return routeError(e);}}
