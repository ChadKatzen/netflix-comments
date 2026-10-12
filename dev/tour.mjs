// "Use it like a viewer" tour: launches a visible Chrome for Testing with the extension, seeds a title with
// realistic comments, then walks through the UI taking screenshots. Usage:
//   node dev/tour.mjs [out-dir]        (server must be running on :3131)
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const CHROME = process.env.CHROME_BIN || findChrome();
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (existsSync(root)) for (const v of readdirSync(root).sort().reverse()) {
    const p = join(root, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(p)) return p;
  }
  console.error('Set CHROME_BIN or: npx @puppeteer/browsers install chrome@stable'); process.exit(2);
}
const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const PORT = 9334, PROFILE = join(process.env.TMPDIR || '/tmp', 'nfc-tour-profile');
const OUT = process.argv[2] || join(process.env.TMPDIR || '/tmp', 'nfc-tour'); mkdirSync(OUT, { recursive: true });
const HEADLESS = process.env.HEADLESS === '1';
const API = 'http://localhost:3131';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- seed a believable title ----
const VID = process.env.VID || 'tour-' + Date.now().toString(36);
const api = async (path, method, body) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { console.error('seed failed', method, path, r.status, j); process.exit(4); }
  return j;
};
const people = [['mara_k', 'u_mara0001'], ['devon', 'u_devon001'], ['sunny.b', 'u_sunny001'], ['jtroll', 'u_jtrol001'], ['priya', 'u_priya001'], ['oldmanrivers', 'u_oldma001'], ['kat', 'u_kat00001'], ['teo', 'u_teo00001']];
const seed = [
  [4, 0, 'ok the opening shot is gorgeous'], [9, 1, 'that butterfly animation is 2008 and still holds up'],
  [14, 2, 'he looks like my uncle after thanksgiving'], [22, 3, 'THE STRETCH'], [31, 4, 'wait is this the whole plot? a rabbit waking up?'],
  [38, 5, 'the squirrels are the real villains, watch'], [45, 6, 'this is where it gets good'], [52, 7, 'pause here. look at the fur detail'],
  [61, 0, 'why does the apple look so good'], [75, 1, 'the flying squirrel has done nothing wrong'], [88, 2, 'he is just like me fr'],
  [104, 3, 'this part always gets me'], [120, 4, 'the music swell here 😭'], [131, 5, 'ok they are definitely bullying him'],
  [140, 6, 'this is the turning point. he is DONE'], [142, 7, 'the stare'], [143, 0, 'EYEBROWS'], [150, 1, 'montage incoming'],
  [168, 2, 'rambo bunny'], [190, 3, 'that trap is overengineered'], [210, 4, 'the chipmunk had a family'], [245, 5, 'absolute cinema'],
  [260, 6, 'first time watching, is it always this violent'], [301, 7, 'second act slaps'], [333, 0, 'the bird reveal lol'],
  [402, 1, 'ending incoming, get tissues'], [455, 2, 'credits song is a banger'], [520, 3, 'did anyone else cry'],
];
const ids = [];
await api(`/api/titles/${VID}`, 'PUT', { name: 'Big Buck Bunny E1 The Mock Episode', duration: 596 });
for (const [t, p, body] of seed) {
  const r = await api(`/api/titles/${VID}/comments`, 'POST', { t, body, authorId: people[p][1], authorName: people[p][0] });
  ids.push(r.id);
}
// likes: make a clear "top" ordering + replies on a few
const likeMap = { 3: 7, 11: 6, 14: 8, 16: 5, 6: 4, 21: 3, 12: 2, 24: 2, 18: 1 };
for (const [i, n] of Object.entries(likeMap)) for (let k = 0; k < n; k++) await api(`/api/comments/${ids[i]}/like`, 'POST', { userId: people[k][1] });
await api(`/api/titles/${VID}/comments`, 'POST', { t: 0, parentId: ids[14], body: 'the eyebrow raise is the whole movie', authorId: people[1][1], authorName: people[1][0] });
await api(`/api/titles/${VID}/comments`, 'POST', { t: 0, parentId: ids[14], body: 'rabbit john wick', authorId: people[3][1], authorName: people[3][0] });
await api(`/api/titles/${VID}/comments`, 'POST', { t: 0, parentId: ids[3], body: 'every morning', authorId: people[6][1], authorName: people[6][0] });
console.log('seeded', VID, ids.length, 'comments');

// ---- launch ----
rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(CHROME, [...(HEADLESS ? ['--headless=new'] : []), `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-mock-keychain', '--password-store=basic', `http://localhost:3131/watch/${VID}`], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
let up = false;
for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch {} if (!up) await sleep(250); }
if (!up) { console.error('Chrome did not expose DevTools on', PORT, '(is another instance using the profile?)'); process.exit(3); }
await sleep(1000);
let targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('/watch/'));
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); p(msg); } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('shot', name); };
await send('Runtime.enable'); await send('Page.enable');
const sh = `document.getElementById('nfc-host').shadowRoot`;
const video = `document.querySelector('video')`;
const seekTo = async (t) => { await ev(`(async()=>{const v=${video}; v.currentTime=${t}; await new Promise(r=>v.addEventListener('seeked',r,{once:true})); v.dispatchEvent(new Event('timeupdate'));})()`); };

// wait for video metadata + overlay
for (let i = 0; i < 80; i++) { if (await ev(`!!document.getElementById('nfc-host') && ${video}.readyState >= 1`)) break; await sleep(250); }
await sleep(1500);

// 1. landing: drawer open at 0:00
await ev(`${video}.play()`); await sleep(1500);
await shot('01-landing');

// 2. into the show: 2:25, live tab with "happening now"
await seekTo(141); await sleep(2500);
await shot('02-live-2m21');

// 3. expand replies on the hot comment
await ev(`[...${sh}.querySelectorAll('.cm')].find(r=>r.querySelector('.txt').textContent.includes('turning point'))?.querySelector('[data-act=toggle]')?.click()`); await sleep(500);
await shot('03-replies');

// 4. compose: pause + type
await ev(`${sh}.querySelector('textarea').focus()`); await sleep(300);
await ev(`(()=>{const ta=${sh}.querySelector('textarea'); ta.value='ok the eyebrow thing is actually incredible'; ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await sleep(300); await shot('04-composing');
await ev(`${sh}.querySelector('.send').click()`); await sleep(2500);
await shot('05-posted');

// 5. top tab
await ev(`${sh}.querySelector('.tab[data-tab=top]').click()`); await sleep(500);
await shot('06-top');

// 6. spoiler guard off on top tab
await ev(`${sh}.querySelector('.spoiler').click()`); await sleep(500);
await shot('07-top-spoilers-shown');
await ev(`${sh}.querySelector('.spoiler').click()`);

// 7. drawer closed, toast as we pass 2:25 area again
await ev(`${sh}.querySelector('.close').click()`);
await seekTo(139.5); await ev(`${video}.play()`); await sleep(3200);
await shot('08-closed-toasts');

// 8. hover strip tooltip + new tab
await ev(`${sh}.querySelector('.pill').click()`); await sleep(300);
await ev(`${sh}.querySelector('.tab[data-tab=new]').click()`); await sleep(400);
await shot('09-new');

// 9. narrow window (laptop) check
await send('Browser.setWindowBounds', { windowId: (await send('Browser.getWindowForTarget', {})).result.windowId, bounds: { width: 1100, height: 700 } }).catch(() => {});
await sleep(800); await ev(`${sh}.querySelector('.tab[data-tab=live]').click()`); await sleep(400);
await shot('10-small-window');

console.log('errors:', errors.length ? errors : 'none');
console.log('VID', VID, '→ keep browsing at http://localhost:3131/watch/' + VID + '');
if (process.env.KEEP !== '1') process.exit(0);
await new Promise(() => {});
