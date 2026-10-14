import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const {identity, service} = await membershipContext(); const url = new URL(request.url);
    return jsonResponse(await service.listMembers(identity, {q: url.searchParams.get('q') || '', page: Number(url.searchParams.get('page') || '1')}));
  } catch (error) { return routeError(error); }
}
