import { AuthScreen } from '../auth-screen';
import { safeReturnPath } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Giriş yap · Anime Takvimi'};
export default async function Login({searchParams}: {searchParams: Promise<{return_to?: string}>}) {
  const params = await searchParams;
  return <AuthScreen mode="login" returnTo={safeReturnPath(params.return_to)}/>;
}
