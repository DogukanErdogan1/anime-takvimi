import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { MembershipError } from './membership.mjs';
import { createCommunityService } from './community.mjs';

export function communityService() { return createCommunityService(env.DB); }
export async function communityContext() {
  const identity = await getChatGPTUser();
  if (!identity) throw new MembershipError(401, 'sign_in_required', 'Önce giriş yapın.');
  return {identity, service: communityService()};
}
