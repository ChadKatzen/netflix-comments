// End-to-end test: drives Chrome for Testing with the extension loaded against the mock player,
// over the DevTools protocol using Node's built-in WebSocket. Zero dependencies.
//
//   1. start the server:  cd server && npm start
//   2. run:               node dev/e2e.mjs [screenshot-dir]
//
// Needs a Chrome that honors --load-extension (Chrome for Testing / Chromium; branded Google Chrome
// dropped the flag in 137). Set CHROME_BIN, or install one with:
//   npx @puppeteer/browsers install chrome@stable
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const CHROME = process.env.CHROME_BIN || findChrome();
function findChrome() {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (existsSync(root)) {
    for (const v of readdirSync(root).sort().reverse()) {
      const p = join(root, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (existsSync(p)) return p;
      const l = join(root, v, 'chrome-linux64', 'chrome');
      if (existsSync(l)) return l;
    }
  }
  console.error('No Chrome for Testing found. Set CHROME_BIN or run: npx @puppeteer/browsers install chrome@stable');
  process.exit(2);
}
const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const PORT = 9333, PROFILE = join(process.env.TMPDIR || '/tmp', 'nfc-e2e-profile');
const OUT = process.argv[2] || join(process.env.TMPDIR || '/tmp', 'nfc-e2e-shots');
mkdirSync(OUT, { recursive: true });
console.log('chrome:', CHROME);
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', '--autoplay-policy=no-user-gesture-required',
  '--mute-audio', '--use-mock-keychain', '--password-store=basic', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeLog = ''; chrome.stderr.on('data', (d) => (chromeLog += d));
const kill = () => { try { chrome.kill('SIGKILL'); } catch {} };
process.on('exit', kill);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPort() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json(); } catch {} await sleep(250); } throw new Error('chrome did not start\n' + chromeLog); }

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } else this.events.push(msg); }; }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); return new CDP(ws); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))); return r.result.value; }
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('  screenshot', `${OUT}/${name}.png`); }
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

try {
  await waitPort();
  // confirm the extension loaded (service worker target exists)
  let targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  for (let i = 0; i < 20 && !targets.some((t) => t.type === 'service_worker'); i++) { await sleep(250); targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
  const sw = targets.find((t) => t.type === 'service_worker' && /background\.js$/.test(t.url));
  check('extension service worker registered', !!sw, sw?.url);
  const extId = sw ? new URL(sw.url).hostname : null;

  // seed a fresh title through the API so runs don't pollute each other
  const VID = 'e2e-' + Date.now().toString(36);
  const api = (path, method, body) => fetch('http://localhost:3131' + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  await api(`/api/titles/${VID}`, 'PUT', { name: 'E2E Title', duration: 600 });
  await api(`/api/titles/${VID}/comments`, 'POST', { t: 330, body: 'second bucket', authorId: 'user_seed0001', authorName: 'seed' });
  const BODY = 'posted from e2e ' + VID;

  // open the mock player
  const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?http://localhost:3131/watch/${VID}`, { method: 'PUT' })).json();
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Log.enable');
  await sleep(2500);

  const host = () => `document.getElementById('nfc-host')`;
  const sh = () => `${host()}.shadowRoot`;
  check('overlay host injected', await c.eval(`!!${host()}`));
  check('drawer rendered in shadow DOM', await c.eval(`!!${sh()}.querySelector('.drawer')`));
  await sleep(1500);
  const header = await c.eval(`${sh()}.querySelector('.name').textContent`);
  check('title name shown in header', /Big Buck Bunny|E2E Title/.test(header), header);
  const sub = await c.eval(`${sh()}.querySelector('.sub').textContent`);
  check('meta loaded (comment count in header)', /comment/.test(sub), sub);
  const bars = await c.eval(`${sh()}.querySelectorAll('.hist i').length`);
  check('timeline histogram rendered', bars > 0, bars + ' bars');

  // playhead: set video time to 330s where a seeded comment lives; check live tab shows it
  await c.eval(`(async()=>{const v=document.querySelector('video'); v.muted=true; v.currentTime=332; await new Promise(r=>v.addEventListener('seeked',r,{once:true})); v.dispatchEvent(new Event('timeupdate'));})()`);
  await sleep(2500);
  const liveBodies = await c.eval(`[...${sh()}.querySelectorAll('.list .cm .txt')].map(e=>e.textContent)`);
  check('live tab shows comment at 5:30 bucket', liveBodies.includes('second bucket'), JSON.stringify(liveBodies));
  const nowRow = await c.eval(`!!${sh()}.querySelector('.list .cm.now')`);
  check('comment within window highlighted as "now"', nowRow);

  // spoiler guard: at t=10 the 5:30 comment must be hidden and the hidden-row visible
  await c.eval(`(async()=>{const v=document.querySelector('video'); v.currentTime=10; await new Promise(r=>v.addEventListener('seeked',r,{once:true})); v.dispatchEvent(new Event('timeupdate'));})()`);
  await sleep(1200);
  const hiddenRow = await c.eval(`${sh()}.querySelector('.hidden-row, .empty')?.textContent || ''`);
  const stillShown = await c.eval(`[...${sh()}.querySelectorAll('.list .cm .txt')].map(e=>e.textContent)`);
  check('spoiler guard hides comment ahead of playhead', !stillShown.includes('second bucket') && /ahead/.test(hiddenRow), hiddenRow.trim());
  await c.shot('01-live-spoiler-guard');

  // compose + post at current time via the UI
  await c.eval(`(()=>{const v=document.querySelector('video'); v.play(); })()`);
  await sleep(800);
  await c.eval(`${sh()}.querySelector('textarea').focus()`);
  await sleep(300);
  const pausedOnCompose = await c.eval(`document.querySelector('video').paused`);
  check('video pauses when composer focused', pausedOnCompose);
  const atLabel = await c.eval(`${sh()}.querySelector('.at').textContent`);
  await c.eval(`(()=>{const ta=${sh()}.querySelector('textarea'); ta.value=${JSON.stringify(BODY)}; ta.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await c.eval(`${sh()}.querySelector('.send').click()`);
  await sleep(400);
  const pendingShown = await c.eval(`[...${sh()}.querySelectorAll('.list .cm .txt')].map(e=>e.textContent).includes(${JSON.stringify(BODY)})`);
  check('optimistic comment appears immediately', pendingShown);
  await sleep(2500);
  const server = await (await fetch(`http://localhost:3131/t/${VID}/meta.json`)).json();
  const mine = server.newest.find((x) => x.body === BODY);
  check('comment reached the server', !!mine, mine ? `id=${mine.id} t=${mine.t} at-label=${atLabel}` : JSON.stringify(server.newest.map((x) => x.body)));
  const acked = await c.eval(`!${sh()}.querySelector('.list .cm.pending')`);
  check('pending state cleared after ack', acked);
  const resumed = await c.eval(`!document.querySelector('video').paused`);
  check('video resumes after posting', resumed);

  // like it via UI, verify optimistic count then server count
  await c.eval(`(()=>{const row=[...${sh()}.querySelectorAll('.list .cm')].find(r=>r.querySelector('.txt').textContent===${JSON.stringify(BODY)}); row.querySelector('[data-act=like]').click();})()`);
  await sleep(200);
  const likeNow = await c.eval(`(()=>{const row=[...${sh()}.querySelectorAll('.list .cm')].find(r=>r.querySelector('.txt').textContent===${JSON.stringify(BODY)}); return row.querySelector('.like').className+'|'+row.querySelector('.like span').textContent;})()`);
  check('like applied optimistically', /\bon\b/.test(likeNow) && /\|1$/.test(likeNow), likeNow);
  await sleep(1500);
  const server2 = await (await fetch(`http://localhost:3131/t/${VID}/meta.json`)).json();
  check('like reached the server', server2.top.find((x) => x.body === BODY)?.likeCount === 1);

  // reply flow
  await c.eval(`(()=>{const row=[...${sh()}.querySelectorAll('.list .cm')].find(r=>r.querySelector('.txt').textContent===${JSON.stringify(BODY)}); row.querySelector('[data-act=reply]').click();})()`);
  await sleep(200);
  const replyLabel = await c.eval(`${sh()}.querySelector('.replyto').textContent`);
  await c.eval(`(()=>{const ta=${sh()}.querySelector('textarea'); ta.value='a reply'; ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await sleep(2500);
  const bucket0 = await (await fetch(`http://localhost:3131/t/${VID}/b/0.json`)).json();
  const reply = bucket0.comments.find((x) => x.body === 'a reply');
  check('reply posted with parent + inherited timestamp', !!reply && reply.parentId === mine?.id && reply.t === mine?.t, replyLabel.trim());
  const replyShown = await c.eval(`!!${sh()}.querySelector('.list .cm.reply')`);
  check('reply rendered under parent', replyShown);

  // Top tab + keyboard isolation (space inside textarea must not toggle the page's video)
  await c.eval(`${sh()}.querySelector('.tab[data-tab=top]').click()`);
  await sleep(300);
  const topFirst = await c.eval(`${sh()}.querySelector('.list .cm .txt')?.textContent`);
  check('top tab sorts by likes', topFirst === BODY, topFirst);
  await c.eval(`document.querySelector('video').pause()`);
  await c.eval(`(()=>{const ta=${sh()}.querySelector('textarea'); ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,composed:true}));})()`);
  await sleep(300);
  const stillPaused = await c.eval(`document.querySelector('video').paused`);
  check('space in composer does not reach player hotkeys', stillPaused);
  await c.shot('02-top-tab');

  // toggle drawer closed via Shift+C, toast when passing a comment
  await c.eval(`${sh()}.querySelector('textarea').blur(); ${sh()}.querySelector('.close').click()`);
  await sleep(200);
  check('pill shown when drawer closed', await c.eval(`!${sh()}.querySelector('.pill').classList.contains('hide') && ${sh()}.querySelector('.drawer').classList.contains('hide')`));
  await c.eval(`(async()=>{const v=document.querySelector('video'); v.currentTime=${mine ? mine.t - 0.5 : 9}; await new Promise(r=>v.addEventListener('seeked',r,{once:true})); v.play(); })()`);
  await sleep(1800);
  const toasts = await c.eval(`[...${sh()}.querySelectorAll('.toast .txt')].map(e=>e.textContent)`);
  check('toast pops when playhead passes a comment', toasts.includes(BODY), JSON.stringify(toasts));
  await c.shot('03-toast-drawer-closed');

  // console errors from our scripts?
  const errs = c.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  check('no uncaught exceptions in page/content scripts', errs.length === 0, errs.join(' | ').slice(0, 500));

  // popup page loads
  if (extId) {
    const pop = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const p = await CDP.connect(pop.webSocketDebuggerUrl); await p.send('Runtime.enable'); await p.send('Page.enable');
    await p.send('Page.navigate', { url: `chrome-extension://${extId}/popup.html` });
    for (let i = 0; i < 40 && !(await p.eval(`!!document.getElementById('dot')`)); i++) await sleep(250);
    await sleep(1500);
    const dot = await p.eval(`(document.getElementById('dot')?.className ?? 'no-popup-dom') + '|' + (document.getElementById('displayName')?.value ?? '')`);
    check('popup loads and health check passes', /ok/.test(dot), dot + (/ok/.test(dot) ? '' : '  (Chrome for Testing 155 headless fails to serve extension resources; passes on 148)'));
    await p.shot('04-popup');
  }
} catch (e) {
  results.push({ name: 'harness error: ' + e.message, ok: false });
  console.error('TEST ERROR', e);
  console.error(chromeLog.slice(-2000));
} finally {
  kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
