// Service worker: proxies HTTP for the content script (content scripts can't rely on host permissions
// for cross-origin fetches; the extension process can) and requests optional host permissions.
const TIMEOUT_MS = 8000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fetch') {
    doFetch(msg).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
    return true; // async
  }
  if (msg?.type === 'hasPermission') {
    chrome.permissions.contains({ origins: [originPattern(msg.url)] }).then((ok) => sendResponse({ ok }));
    return true;
  }
});

async function doFetch({ url, method = 'GET', body }) {
  let origin;
  try { origin = originPattern(url); } catch { return { error: 'bad url: ' + url }; }
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    return { error: 'permission', detail: `Open the extension popup and save settings to grant access to ${origin}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: method === 'GET' ? 'default' : 'no-store',
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, body: json };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : 'network: ' + (e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}
