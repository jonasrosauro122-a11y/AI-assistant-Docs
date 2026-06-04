const spineProxyUrl = import.meta.env.VITE_SPINE_PROXY_URL;

export const isSpineConfigured = Boolean(
  spineProxyUrl &&
  !spineProxyUrl.includes('your-approved-spine-domain')
);

export async function callSpine(action, payload, accessToken) {
  if (!isSpineConfigured) {
    throw new Error('Spine proxy is not configured. Add VITE_SPINE_PROXY_URL.');
  }

  const response = await fetch(spineProxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    credentials: 'include',
    body: JSON.stringify({ action, payload })
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    throw new Error(data.error || data.message || `Spine request failed: ${response.status}`);
  }

  return data;
}
