import { env } from 'cloudflare:workers';
import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { createBannerService } from '@/lib/banners.mjs';
export const dynamic = 'force-dynamic';
type Context = {params: Promise<{id:string}>};
export async function GET(request: Request, context: Context) {
  try {
    const {id} = await context.params;
    const service = createBannerService(env.DB,env.BUCKET); const url = new URL(request.url);
    if (!url.searchParams.has('image')) return jsonResponse(await service.info(id));
    const image = await service.get(id,url.searchParams.get('image'));
    return new Response(image.body,{headers:{'Content-Type':image.contentType,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Disposition':'inline; filename="banner"'}});
  } catch (error) { return routeError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const {identity} = await membershipContext(); const {id} = await context.params;
    return jsonResponse(await createBannerService(env.DB,env.BUCKET).upload(identity,id,request));
  } catch (error) { return routeError(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const {identity} = await membershipContext(); const {id} = await context.params;
    return jsonResponse(await createBannerService(env.DB,env.BUCKET).remove(identity,id,request));
  } catch (error) { return routeError(error); }
}
