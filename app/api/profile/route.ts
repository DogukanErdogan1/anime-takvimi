import { jsonResponse, routeError } from '@/lib/account-route';
import { communityContext } from '@/lib/community-route';
import { readJsonMutation } from '@/lib/membership.mjs';
import { env } from 'cloudflare:workers';
import { createProfileCoverService } from '@/lib/profile-cover.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const {identity, service} = await communityContext(); const result = await service.getProfile(identity);
    const coverUrl = await createProfileCoverService(env.DB, env.BUCKET).ownUrl(identity);
    return jsonResponse({...result, profile: {...result.profile, coverUrl}});
  }
  catch (error) { return routeError(error); }
}
export async function PUT(request: Request) {
  try {
    const payload = await readJsonMutation(request, 4096);
    const {identity, service} = await communityContext();
    const result = await service.putProfile(identity, payload);
    const coverUrl = await createProfileCoverService(env.DB, env.BUCKET).ownUrl(identity);
    return jsonResponse({...result, profile: {...result.profile, coverUrl}});
  } catch (error) { return routeError(error); }
}
