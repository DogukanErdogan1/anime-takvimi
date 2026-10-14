import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { readJsonMutation } from '@/lib/membership.mjs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const payload = await readJsonMutation(request, 4096);
    const {identity, service} = await membershipContext(); const {id} = await context.params;
    return jsonResponse(await service.setMemberStatus(identity, id, payload));
  } catch (error) { return routeError(error); }
}
