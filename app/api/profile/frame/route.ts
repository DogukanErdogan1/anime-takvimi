import { env } from 'cloudflare:workers';
import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { createProfileFrameService } from '@/lib/profile-frame.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const {identity} = await membershipContext();
    return jsonResponse(await createProfileFrameService(env.DB).getOwn(identity));
  } catch (error) { return routeError(error); }
}
export async function PUT(request: Request) {
  try {
    const {identity} = await membershipContext();
    return jsonResponse(await createProfileFrameService(env.DB).put(identity, request));
  } catch (error) { return routeError(error); }
}
