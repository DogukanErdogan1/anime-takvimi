import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {parseSessionCookie} from './auth.mjs';
import {createAniListService} from './anilist-sync.mjs';
import {MembershipError} from './membership.mjs';
export async function anilistContext(request:Request){const identity=await getChatGPTUser(),scope=request.headers.get('X-Library-Account');if(scope&&scope!==identity?.userId)throw new MembershipError(409,'account_changed','Hesap değişti. Aynı hesabınla yeniden dene.');return {identity,service:createAniListService(env.DB,env),sessionToken:parseSessionCookie(request.headers.get('cookie'))};}
export function stateCookie(value:string|null,url:string){return `anime_anilist_state=${value||''}; Path=/api/integrations/anilist; HttpOnly; SameSite=Lax; Max-Age=${value?'600':'0'}${new URL(url).protocol==='https:'?'; Secure':''}`;}
