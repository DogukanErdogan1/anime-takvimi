import { env } from 'cloudflare:workers';
import { routeError } from '@/lib/account-route';
import { createProfileCoverService, profileCoverImageResponse } from '@/lib/profile-cover.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const {id} = await context.params;
    const image = await createProfileCoverService(env.DB, env.BUCKET).getPublic(id, new URL(request.url).searchParams.get('v'));
    return profileCoverImageResponse(image);
  } catch (error) { return routeError(error); }
}
