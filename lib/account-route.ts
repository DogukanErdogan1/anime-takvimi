import { env } from 'cloudflare:workers';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { MembershipError, createMembershipService } from './membership.mjs';
import { createAvatarService } from './avatar.mjs';
export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff'}});
}
export function routeError(error: unknown) {
  if (error instanceof MembershipError) return jsonResponse({error: {code: error.code, message: error.message}}, error.status);
  return jsonResponse({error: {code: 'service_unavailable', message: 'Hesap hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.'}}, 503);
}
export async function membershipContext() {
  const identity = await getChatGPTUser();
  if (!identity) throw new MembershipError(401, 'sign_in_required', 'Önce giriş yapın.');
  if (!env.DB) throw new MembershipError(503, 'service_unavailable', 'Hesap hizmeti şu anda kullanılamıyor.');
  return {identity, service: createMembershipService(env.DB)};
}
export function accountLinks<T extends {authenticated: boolean}>(account: T) {
  return account.authenticated ? {...account, signOutUrl: chatGPTSignOutPath('/')} : {...account, signInUrl: chatGPTSignInPath('/'), registerUrl: '/uye-ol'};
}
export async function accountResponse() {
  const identity = await getChatGPTUser();
  if (!identity) return jsonResponse(accountLinks({authenticated: false, registered: false}));
  const {service} = await membershipContext();
  const account = await service.account(identity);
  if (account.registered && account.user?.status === 'active' && env.BUCKET) {
    let avatarUrl = null;
    try { avatarUrl = await createAvatarService(env.DB,env.BUCKET).url(identity); }
    catch (error) {
      // Accounts remain readable while an earlier deployment awaits its migration.
      const message = error instanceof Error ? error.message : '';
      if (!/no such table: member_avatars/i.test(message)) throw error;
    }
    return jsonResponse(accountLinks({...account,user:{...account.user,avatarUrl}}));
  }
  return jsonResponse(accountLinks(account));
}
