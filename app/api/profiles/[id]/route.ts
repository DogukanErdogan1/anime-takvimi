import { jsonResponse, routeError } from '@/lib/account-route';
import { communityService } from '@/lib/community-route';
import { env } from 'cloudflare:workers';
import { createProfileCoverService } from '@/lib/profile-cover.mjs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const {id} = await context.params; const result = await communityService().getPublicProfile(id);
    const coverUrl = await createProfileCoverService(env.DB, env.BUCKET).publicUrl(id);
    return jsonResponse({...result, profile: {...result.profile, coverUrl}});
  }
  catch (error) { return routeError(error); }
}
