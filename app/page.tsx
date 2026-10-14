import Script from 'next/script';
import { animeMarkup } from './anime-markup';
export const dynamic = 'force-dynamic';
export default function Home() {
  return <><div id="anime-site" dangerouslySetInnerHTML={{__html:animeMarkup}}/><Script id="anime-bootstrap" src="/site/bootstrap.js" strategy="afterInteractive"/></>;
}
