import { env } from 'cloudflare:workers';
import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { createAvatarService } from '@/lib/avatar.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const {identity} = await membershipContext();
    return jsonResponse(await createAvatarService(env.DB,env.BUCKET).upload(identity,request));
  } catch (error) { return routeError(error); }
}
export async function GET() {
  try {
    const {identity} = await membershipContext();
    const image = await createAvatarService(env.DB,env.BUCKET).get(identity);
    return new Response(image.body,{headers:{'Content-Type':image.contentType,'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Disposition':'inline; filename="avatar"'}});
  } catch (error) { return routeError(error); }
}
