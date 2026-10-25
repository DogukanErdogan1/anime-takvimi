import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { MembershipError, readJsonMutation } from './membership.mjs';
import {
  createEmailAuthService, parseSessionCookie, sessionCookie, clearSessionCookie,
} from './auth.mjs';

export { parseSessionCookie, sessionCookie, clearSessionCookie } from './auth.mjs';

function authService() {
  if (!env.DB) throw new MembershipError(503, 'service_unavailable', 'Hesap hizmeti şu anda kullanılamıyor.');
  return createEmailAuthService(env.DB);
}

export async function currentAuthUser() {
  const requestHeaders = await headers();
  const token = parseSessionCookie(requestHeaders.get('cookie'));
  if (!token) return null;
  return authService().resolveUser(token);
}

function json(value: unknown, status = 200, cookie?: string) {
  const responseHeaders: Record<string, string> = {
    'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff',
  };
  if (cookie) responseHeaders['Set-Cookie'] = cookie;
  return Response.json(value, {status, headers: responseHeaders});
}

export async function runAuthMutation(request: Request, action: 'register' | 'login' | 'demo' | 'logout') {
  try {
    if (request.method !== 'POST') throw new MembershipError(405, 'method_not_allowed', 'Bu işlem desteklenmiyor.');
    const payload = await readJsonMutation(request, 4096);
    const service = authService();
    if (action === 'logout') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
        throw new MembershipError(400, 'invalid_payload', 'Gönderilen bilgiler geçerli değil.');
      }
      await service.logout(parseSessionCookie(request.headers.get('cookie')));
      return json({ok: true}, 200, clearSessionCookie(request.url));
    }
    const previousToken = parseSessionCookie(request.headers.get('cookie'));
    const result = action === 'register'
      ? await service.register(payload)
      : action === 'demo' ? await service.loginDemo() : await service.login(payload);
    // Signing in rotates any previous session on this browser.
    if (previousToken) await service.logout(previousToken);
    return json({authenticated: true, registered: true, user: result.user}, action === 'register' ? 201 : 200,
      sessionCookie(result.sessionToken, request.url));
  } catch (error) {
    if (error instanceof MembershipError) return json({error: {code: error.code, message: error.message}}, error.status);
    return json({error: {code: 'service_unavailable', message: 'Hesap hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.'}}, 503);
  }
}
