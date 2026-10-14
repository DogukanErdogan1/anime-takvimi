import { accountResponse, routeError } from '@/lib/account-route';
export const dynamic = 'force-dynamic';
export async function GET() { try { return await accountResponse(); } catch (error) { return routeError(error); } }
