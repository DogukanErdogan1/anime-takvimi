import {env} from 'cloudflare:workers';
import {communityContext} from '@/lib/community-route';
import {jsonResponse,routeError} from '@/lib/account-route';
import {readJsonMutation} from '@/lib/membership.mjs';
import {createModerationService} from '@/lib/moderation.mjs';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){try{const payload=await readJsonMutation(request,4096),{identity}=await communityContext(),{id}=await context.params;return jsonResponse(await createModerationService(env.DB).resolve(identity,id,payload));}catch(error){return routeError(error);}}
