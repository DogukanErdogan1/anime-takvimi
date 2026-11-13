import {env} from 'cloudflare:workers';
import {communityContext} from '@/lib/community-route';
import {jsonResponse, routeError} from '@/lib/account-route';
import {readJsonMutation} from '@/lib/membership.mjs';
import {parseSessionCookie} from '@/lib/auth.mjs';
import {createPushService, pushDeviceCookie, pushDeviceCookieValue} from '@/lib/push.mjs';

export const dynamic = 'force-dynamic';
const service = () => createPushService(env.DB, {publicKey: env.PUSH_PUBLIC_KEY, privateKey: env.PUSH_PRIVATE_KEY});
export async function GET(request: Request) {
  try {const {identity} = await communityContext(); return jsonResponse(await service().status(identity, parseSessionCookie(request.headers.get('cookie')), pushDeviceCookie(request), new URL(request.url).searchParams.get('anime')));}
  catch (error) {return routeError(error);}
}
export async function POST(request: Request) {
  try {
    const payload = await readJsonMutation(request, 4096);
    const {identity} = await communityContext(), token = parseSessionCookie(request.headers.get('cookie'));
    if (payload?.action === 'unsubscribe' && Object.keys(payload).length === 1) {
      const response = jsonResponse(await service().unsubscribe(identity, token, pushDeviceCookie(request)));
      response.headers.append('Set-Cookie', pushDeviceCookieValue(null, request.url)); return response;
    }
    const result = await service().subscribe(identity, token, pushDeviceCookie(request), payload);
    const response = jsonResponse({active: true, bindingId: result.bindingId});
    response.headers.append('Set-Cookie', pushDeviceCookieValue(result.deviceToken, request.url)); return response;
  } catch (error) {return routeError(error);}
}
