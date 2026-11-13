import {env} from 'cloudflare:workers';
import {communityContext} from '@/lib/community-route';
import {jsonResponse,routeError} from '@/lib/account-route';
import {createModerationService} from '@/lib/moderation.mjs';
export async function GET(){try{const {identity}=await communityContext();return jsonResponse(await createModerationService(env.DB).list(identity));}catch(error){return routeError(error);}}
