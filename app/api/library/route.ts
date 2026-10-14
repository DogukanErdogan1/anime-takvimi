import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { readJsonMutation } from '@/lib/membership.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const {identity, service} = await membershipContext(); return jsonResponse(await service.getLibrary(identity)); }
  catch (error) { return routeError(error); }
}
export async function PUT(request: Request) {
  try {
    const payload = await readJsonMutation(request);
    const {identity, service} = await membershipContext();
    return jsonResponse(await service.putLibrary(identity, payload));
  } catch (error) { return routeError(error); }
}
