const firstHeaderValue = value => typeof value === 'string' ? value.split(',')[0].trim() : '';

// Reverse proxies can expose the public host and protocol through forwarded
// headers while the application request itself uses an internal HTTP URL.
export function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;

  let originUrl;
  let requestUrl;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (originUrl.origin !== origin) return false;

  const host = firstHeaderValue(request.headers.get('x-forwarded-host'))
    || request.headers.get('host')
    || requestUrl.host;
  const protocol = firstHeaderValue(request.headers.get('x-forwarded-proto'))
    || requestUrl.protocol.slice(0, -1);
  if (!host || !['http', 'https'].includes(protocol.toLowerCase())) return false;

  try {
    return origin === new URL(`${protocol.toLowerCase()}://${host}`).origin;
  } catch {
    return false;
  }
}

