import {jsonResponse,routeError} from '@/lib/account-route';
import {anilistContext,stateCookie} from '@/lib/anilist-route';
import {MembershipError,readJsonMutation} from '@/lib/membership.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {identity,service}=await anilistContext(request);return jsonResponse(await service.status(identity));}catch(e){return routeError(e);}}
export async function POST(request:Request){try{const payload=await readJsonMutation(request,32768),{identity,service,sessionToken}=await anilistContext(request);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new MembershipError(400,'invalid_payload','Geçersiz işlem.');
 const {action,...rest}=payload;if(action==='connect'&&!Object.keys(rest).length){const result=await service.begin(identity,sessionToken,new URL(request.url).origin),response=jsonResponse({authorizeUrl:result.authorizeUrl});response.headers.set('Set-Cookie',stateCookie(result.state,request.url));return response;}
 if(action==='disconnect'&&!Object.keys(rest).length)return jsonResponse(await service.disconnect(identity));
 if(action==='preview'&&Object.keys(rest).every(k=>k==='direction'))return jsonResponse(await service.preview(identity,rest.direction));
 if(action==='apply')return jsonResponse(await service.apply(identity,rest));
 throw new MembershipError(400,'invalid_payload','Geçersiz işlem.');}catch(e){return routeError(e);}}
