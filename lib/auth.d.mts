export interface AuthIdentity { userId: string; email: string; displayName: string; fullName: null; }
export interface AuthMember { id: string; email: string; displayName: string; role: 'admin' | 'member'; status: 'active' | 'suspended'; createdAt: string; }
export interface AuthResult { identity: AuthIdentity; user: AuthMember; sessionToken: string; expiresAt: number; }
export const SESSION_COOKIE: string;
export const SESSION_SECONDS: number;
export function normalizeEmail(value: unknown): string;
export function validateSignup(payload: unknown): {email: string; password: string; displayName: string};
export function parseSessionCookie(cookieHeader: string | null): string | null;
export function sessionCookie(token: string, requestUrl: string): string;
export function clearSessionCookie(requestUrl: string): string;
export function createEmailAuthService(db: D1Database, options?: {now?: () => number}): {
  register(payload: unknown): Promise<AuthResult>;
  login(payload: unknown): Promise<AuthResult>;
  resolveUser(sessionToken: string | null | undefined): Promise<AuthIdentity | null>;
  logout(sessionToken: string | null | undefined): Promise<{ok: true}>;
};
