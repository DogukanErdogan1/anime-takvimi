import { jsonResponse, membershipContext, routeError } from '@/lib/account-route';
import { MembershipError,readJsonMutation } from '@/lib/membership.mjs';
import {libraryRevision} from '@/lib/library-revision.mjs';
export const dynamic = 'force-dynamic';
async function responseFor(result:{library:unknown}|undefined){if(!result)throw new MembershipError(503,'library_unavailable','Liste okunamadı.');const response=jsonResponse(result);response.headers.set('ETag','"'+await libraryRevision(result.library)+'"');return response;}
export async function GET() {
  try { const {identity, service} = await membershipContext(); return responseFor(await service.getLibrary(identity)); }
  catch (error) { return routeError(error); }
}
export async function PUT(request: Request) {
  try {
    const payload = await readJsonMutation(request);
    const {identity, service} = await membershipContext();
    const scope=request.headers.get('X-Library-Account');if(scope&&scope!==identity.userId)throw new MembershipError(409,'account_changed','Hesap değişti. Aynı hesaba giriş yaparak eşitle.');
    const match=request.headers.get('If-Match');
    return responseFor(await service.putLibrary(identity, payload,match?{expectedRevision:match.replace(/^"|"$/g,'')}:{}));
  } catch (error) { return routeError(error); }
}
