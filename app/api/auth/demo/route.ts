import { runAuthMutation } from '@/lib/auth-route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return runAuthMutation(request, 'demo'); }
