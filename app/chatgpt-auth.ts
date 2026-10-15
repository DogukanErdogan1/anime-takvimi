import { redirect } from 'next/navigation';
import { currentAuthUser } from '@/lib/auth-route';

// Existing routes use these compatibility exports. Identity comes exclusively
// from the server-verified session, never caller-supplied platform headers.
export type ChatGPTUser = { userId: string; displayName: string; email: string; fullName: string | null };
export const getChatGPTUser = currentAuthUser;
export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await currentAuthUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}
export function safeReturnPath(value = '/'): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://app.local');
    if (url.origin !== 'https://app.local' || ['/giris','/uye-ol','/cikis'].includes(url.pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
export const chatGPTSignInPath = (returnTo = '/') => `/giris?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
export const chatGPTSignOutPath = (returnTo = '/') => `/cikis?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
