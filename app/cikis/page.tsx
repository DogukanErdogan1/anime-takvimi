import { AuthScreen } from '../auth-screen';
import { safeReturnPath } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Çıkış yap · Anime Takvimi'};
export default async function Logout({searchParams}: {searchParams: Promise<{return_to?: string}>}) {
  const params = await searchParams;
  return <AuthScreen mode="logout" returnTo={safeReturnPath(params.return_to)}/>;
}
