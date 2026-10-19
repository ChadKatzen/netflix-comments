const DEFAULTS = { displayName: '', readBase: 'https://netflix-comments-api.katzen-chad.workers.dev', writeBase: 'https://netflix-comments-api.katzen-chad.workers.dev', spoilerGuard: true, showToasts: true, pauseOnCompose: true, panelOpen: true };
const $ = (id) => document.getElementById(id);
const fields = ['displayName', 'readBase', 'writeBase'];
const checks = ['spoilerGuard', 'showToasts', 'pauseOnCompose'];
let settings = { ...DEFAULTS };

async function load() {
  settings = { ...DEFAULTS, ...(await chrome.storage.sync.get('settings')).settings };
  for (const f of fields) $(f).value = settings[f] ?? '';
  for (const c of checks) $(c).checked = !!settings[c];
  const { user } = await chrome.storage.local.get('user');
  $('uid').textContent = user?.userId ?? '(created on first visit)';
  $('utag').textContent = user?.userId ? '#' + (((s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); })('tag:' + user.userId).toString(36).slice(-4).padStart(4, '0')) : '';
  test(true);
}

function originPattern(url) { const u = new URL(url); return `${u.protocol}//${u.hostname}/*`; }

async function save() {
  const next = { ...settings };
  for (const f of fields) next[f] = $(f).value.trim();
  for (const c of checks) next[c] = $(c).checked;
  if (!next.displayName) next.displayName = settings.displayName || 'viewer';
  const origins = [];
  for (const k of ['readBase', 'writeBase']) {
    try { origins.push(originPattern(next[k])); } catch { return status(`Invalid URL in ${k}`, true); }
  }
  // Host permission for non-localhost servers is optional in the manifest; request it on save (user gesture).
  const need = [...new Set(origins)].filter((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)\//.test(o));
  if (need.length) {
    const ok = await chrome.permissions.request({ origins: need });
    if (!ok) return status('Permission for the server origin was denied; the extension cannot reach it.', true);
  }
  settings = next;
  await chrome.storage.sync.set({ settings });
  status('Saved.');
  test(true);
}

async function test(quiet = false) {
  const base = ($('writeBase').value.trim() || DEFAULTS.writeBase).replace(/\/+$/, '');
  $('dot').className = 'dot';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'fetch', url: base + '/api/health', method: 'GET' });
    if (r?.ok && r.body?.ok) {
      $('dot').className = 'dot ok';
      if (!quiet) status(`Server OK — ${r.body.titles} titles, ${r.body.comments} comments.`);
    } else {
      $('dot').className = 'dot bad';
      status(r?.error === 'permission' ? r.detail : `Server not reachable: ${r?.error || 'HTTP ' + r?.status}`, true);
    }
  } catch (e) { $('dot').className = 'dot bad'; status(String(e), true); }
}

function status(msg, err = false) { $('status').textContent = msg; $('status').className = 'status' + (err ? ' err' : ''); }

$('save').addEventListener('click', save);
$('test').addEventListener('click', () => test(false));
$('reset').addEventListener('click', async () => {
  if ($('reset').dataset.c) { await chrome.storage.local.remove('user'); $('uid').textContent = '(created on next Netflix visit)'; $('reset').textContent = 'Reset identity'; delete $('reset').dataset.c; return; }
  $('reset').dataset.c = '1'; $('reset').textContent = 'Really reset?'; setTimeout(() => { delete $('reset').dataset.c; $('reset').textContent = 'Reset identity'; }, 3000);
});
load();
