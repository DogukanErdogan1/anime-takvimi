import { jsonResponse, routeError } from '@/lib/account-route';
import { communityContext, communityService } from '@/lib/community-route';
import { readJsonMutation } from '@/lib/membership.mjs';
export const dynamic = 'force-dynamic';
type Context = {params: Promise<{id: string}>};
export async function GET(request: Request, context: Context) {
  try {
    const {id} = await context.params; const query = new URL(request.url).searchParams;
    return jsonResponse(await communityService().getReviews(id, {page: Number(query.get('page') ?? 1), limit: Number(query.get('limit') ?? 20)}));
  } catch (error) { return routeError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const payload = await readJsonMutation(request, 16384);
    const {identity, service} = await communityContext(); const {id} = await context.params;
    return jsonResponse(await service.postReview(identity, id, payload));
  } catch (error) { return routeError(error); }
}
