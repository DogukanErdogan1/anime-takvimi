import {env} from 'cloudflare:workers';
import {communityContext} from '@/lib/community-route';
import {jsonResponse,routeError} from '@/lib/account-route';
import {readJsonMutation} from '@/lib/membership.mjs';
import {communityAnimeId} from '@/lib/community.mjs';
import {createModerationService} from '@/lib/moderation.mjs';
export async function POST(request:Request,context:{params:Promise<{id:string;reviewId:string}>}){try{const payload=await readJsonMutation(request,4096),{identity}=await communityContext(),{id,reviewId}=await context.params;return jsonResponse(await createModerationService(env.DB).report(identity,communityAnimeId(id),reviewId,payload));}catch(error){return routeError(error);}}
