import { jsonResponse, routeError } from '@/lib/account-route';
import { communityContext } from '@/lib/community-route';
import { readJsonMutation } from '@/lib/membership.mjs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: {params: Promise<{id: string; reviewId: string}>}) {
  try {
    const payload = await readJsonMutation(request, 1024);
    const {identity, service} = await communityContext(); const {id, reviewId} = await context.params;
    return jsonResponse(await service.hideReview(identity, id, reviewId, payload));
  } catch (error) { return routeError(error); }
}
