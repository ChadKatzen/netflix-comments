// Chrome Web Store publishing via the official API. Zero deps.
//   node dev/cws.mjs auth-url                 -> prints the consent URL (open it, click Allow)
//   node dev/cws.mjs auth-code <code|url>     -> exchanges the code for tokens (saved to ~/.config/cws/token.json)
//   node dev/cws.mjs create <zip>             -> creates a new store item, prints its id (saved to ~/.config/cws/item.json)
//   node dev/cws.mjs upload <zip> [itemId]    -> uploads a new version to an existing item
//   node dev/cws.mjs status [itemId]          -> item state
//   node dev/cws.mjs publish [itemId] [--trusted-testers]  -> submits for review / publishes
// Credentials live outside the repo: ~/.config/cws/client.json (OAuth desktop client), token.json, item.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.config', 'cws');
const P = { client: join(DIR, 'client.json'), token: join(DIR, 'token.json'), item: join(DIR, 'item.json') };
const REDIRECT = 'http://127.0.0.1:8977/'; // loopback; we read the code from the address bar, no listener needed
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const [cmd, ...args] = process.argv.slice(2);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const client = () => { const j = readJson(P.client); return j.installed || j.web || j; };

async function accessToken() {
  const t = readJson(P.token); const c = client();
  if (t.expires_at && Date.now() < t.expires_at - 60_000) return t.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json(); if (!j.access_token) throw new Error('refresh failed: ' + JSON.stringify(j));
  writeFileSync(P.token, JSON.stringify({ ...t, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 }, null, 2));
  return j.access_token;
}
const api = async (method, url, body, type) => {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await accessToken(), 'x-goog-api-version': '2', ...(type ? { 'Content-Type': type } : {}) }, body });
  const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 500)}`);
  return j;
};
async function exchange(code) {
  const c = client();
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await r.json(); if (!j.refresh_token) throw new Error('token exchange failed: ' + JSON.stringify(j));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(P.token, JSON.stringify({ refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 }, null, 2), { mode: 0o600 });
}
const itemId = (arg) => arg || (existsSync(P.item) ? readJson(P.item).id : null) || (() => { throw new Error('no item id; run create first or pass one'); })();

if (cmd === 'auth-url') {
  const c = client();
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: c.client_id, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent' });
  console.log(u.toString());
} else if (cmd === 'auth-serve') {
  // Listen on the loopback redirect for the code (used when the consent page can reach this machine).
  const http = await import('node:http');
  await new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const code = new URL(req.url, REDIRECT).searchParams.get('code');
      if (!code) { res.writeHead(404); return res.end('no code'); }
      try { await exchange(code); res.end('Community Swim publisher authorized. You can close this tab.'); console.log('tokens saved to', P.token); }
      catch (e) { res.writeHead(500); res.end('exchange failed: ' + e.message); console.error(e); }
      srv.close(); resolve();
    });
    srv.listen(8977, '127.0.0.1', () => console.log('listening on', REDIRECT));
    setTimeout(() => { console.log('timed out'); srv.close(); resolve(); }, Number(args[0] || 120) * 1000);
  });
} else if (cmd === 'auth-code') {
  let code = args[0];
  if (/^https?:/.test(code)) code = new URL(code).searchParams.get('code');
  await exchange(code);
  console.log('tokens saved to', P.token);
} else if (cmd === 'create') {
  const j = await api('POST', 'https://www.googleapis.com/upload/chromewebstore/v1.1/items', readFileSync(args[0]), 'application/zip');
  console.log(JSON.stringify(j));
  if (j.id) { writeFileSync(P.item, JSON.stringify({ id: j.id, createdAt: new Date().toISOString() }, null, 2)); console.log('item id', j.id, 'saved to', P.item); }
} else if (cmd === 'upload') {
  const id = itemId(args[1]);
  console.log(JSON.stringify(await api('PUT', `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}`, readFileSync(args[0]), 'application/zip')));
} else if (cmd === 'status') {
  console.log(JSON.stringify(await api('GET', `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId(args[0])}?projection=DRAFT`)));
} else if (cmd === 'publish') {
  const id = itemId(args.find((a) => !a.startsWith('--')));
  const target = args.includes('--trusted-testers') ? 'trustedTesters' : 'default';
  console.log(JSON.stringify(await api('POST', `https://www.googleapis.com/chromewebstore/v1.1/items/${id}/publish?publishTarget=${target}`, '')));
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 9).join('\n'));
}
