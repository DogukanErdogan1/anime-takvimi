import { AuthScreen } from '../auth-screen';
import { safeReturnPath } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Üye ol · Anime Takvimi'};
export default async function Register({searchParams}: {searchParams: Promise<{return_to?: string}>}) {
  const params = await searchParams;
  return <AuthScreen mode="register" returnTo={safeReturnPath(params.return_to)}/>;
}
