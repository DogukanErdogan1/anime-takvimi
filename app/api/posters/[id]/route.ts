import {createPosterService, PosterError} from '@/lib/posters.mjs';
export const dynamic = 'force-dynamic';
const posters = createPosterService();
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    if (new URL(request.url).search) return new Response(null, {status: 400, headers: {'Cache-Control': 'no-store'}});
    const {id} = await context.params, image = await posters.get(id);
    const headers = {'Content-Type': image.contentType, 'Cache-Control': image.stale ? 'public, max-age=60' : 'public, max-age=86400, stale-while-revalidate=604800', ETag: image.etag, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin'};
    if (request.headers.get('if-none-match') === image.etag) return new Response(null, {status: 304, headers});
    return new Response(image.bytes, {headers});
  } catch (error) {
    const status = error instanceof PosterError ? error.status : 503;
    return new Response(null, {status, headers: {'Cache-Control': 'no-store', 'Retry-After': '3', 'X-Content-Type-Options': 'nosniff'}});
  }
}
