import { env } from 'cloudflare:workers';
import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { createProfileCoverService, profileCoverImageResponse } from '@/lib/profile-cover.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const {identity} = await membershipContext();
    const image = await createProfileCoverService(env.DB, env.BUCKET).getOwn(identity, new URL(request.url).searchParams.get('v'));
    return profileCoverImageResponse(image);
  } catch (error) { return routeError(error); }
}
export async function POST(request: Request) {
  try {
    const {identity} = await membershipContext();
    return jsonResponse(await createProfileCoverService(env.DB, env.BUCKET).upload(identity, request));
  } catch (error) { return routeError(error); }
}
export async function DELETE(request: Request) {
  try {
    const {identity} = await membershipContext();
    return jsonResponse(await createProfileCoverService(env.DB, env.BUCKET).remove(identity, request));
  } catch (error) { return routeError(error); }
}
