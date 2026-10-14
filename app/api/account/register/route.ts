import { accountLinks, jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { readJsonMutation } from '@/lib/membership.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const payload = await readJsonMutation(request, 4096);
    const {identity, service} = await membershipContext();
    return jsonResponse(accountLinks(await service.register(identity, payload)), 201);
  } catch (error) { return routeError(error); }
}
