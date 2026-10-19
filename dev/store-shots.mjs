// Store-listing screenshots at exactly 1280x800 from the mock player (synthetic picture, no third-party frames).
//   node dev/store-shots.mjs [out-dir]   (server on :3131 required)
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_BIN || (() => { const r = join(homedir(), '.cache', 'puppeteer', 'chrome'); for (const v of readdirSync(r).sort().reverse()) { const p = join(r, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'); if (existsSync(p)) return p; } throw new Error('no chrome'); })();
const OUT = process.argv[2] || join(root, 'store', 'screenshots'); mkdirSync(OUT, { recursive: true });
const PORT = 9341, PROFILE = join(process.env.TMPDIR || '/tmp', 'nfc-store-profile'); rmSync(PROFILE, { recursive: true, force: true });
const API = 'http://localhost:3131'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, m, b) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); if (!r.ok) throw new Error(m + p + ' ' + r.status); return r.json(); };
const VID = 'store-' + Date.now().toString(36);
const people = [['mara_k','u_mara0001'],['devon','u_devon001'],['sunny.b','u_sunny001'],['jtroll','u_jtrol001'],['priya','u_priya001'],['oldmanrivers','u_oldma001'],['kat','u_kat00001'],['teo','u_teo00001']];
const seed = [[4,0,'ok the opening shot is gorgeous'],[9,1,'that title sequence still holds up'],[14,2,'he looks like my uncle after thanksgiving'],[22,3,'THE STRETCH'],[31,4,'wait is this the whole plot?'],[38,5,'the squirrels are the real villains, watch'],[45,6,'this is where it gets good'],[52,7,'pause here. look at the background'],[61,0,'why does the apple look so good'],[75,1,'the flying squirrel has done nothing wrong'],[88,2,'he is just like me fr'],[104,3,'this part always gets me'],[120,4,'the music swell here 😭'],[131,5,'ok they are definitely bullying him'],[140,6,'this is the turning point. he is DONE'],[142,7,'the stare'],[143,0,'EYEBROWS'],[150,1,'montage incoming'],[168,2,'rambo bunny'],[190,3,'that trap is overengineered'],[210,4,'the chipmunk had a family'],[245,5,'absolute cinema'],[301,7,'second act slaps'],[402,1,'ending incoming, get tissues'],[455,2,'credits song is a banger'],[520,3,'did anyone else cry']];
await api(`/api/titles/${VID}`, 'PUT', { name: 'Big Buck Bunny · S1 E1 The Mock Episode', duration: 596 });
const ids = []; for (const [t, p, body] of seed) ids.push((await api(`/api/titles/${VID}/comments`, 'POST', { t, body, authorId: people[p][1], authorName: people[p][0] })).id);
for (const [i, n] of Object.entries({ 3: 7, 11: 6, 14: 9, 16: 5, 6: 4, 21: 3, 12: 2, 24: 2 })) for (let k = 0; k < n; k++) await api(`/api/comments/${ids[i]}/like`, "POST", { userId: `u_liker${String(k).padStart(4, "0")}` });
await api(`/api/titles/${VID}/comments`, 'POST', { t: 0, parentId: ids[14], body: 'the eyebrow raise is the whole movie', authorId: people[1][1], authorName: people[1][0] });
await api(`/api/titles/${VID}/comments`, 'POST', { t: 0, parentId: ids[14], body: 'rabbit john wick', authorId: people[3][1], authorName: people[3][0] });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, `--load-extension=${join(root, 'extension')}`, '--no-first-run', '--mute-audio', '--use-mock-keychain', '--window-size=1280,800', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch {} if (!up) await sleep(250); }
await sleep(1500);
const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, n + '.png'), Buffer.from(r.result.data, 'base64')); console.log('shot', n); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:3131/watch/${VID}` });
const sh = `document.getElementById('nfc-host').shadowRoot`, video = `document.querySelector('video')`;
for (let i = 0; i < 80; i++) { if (await ev(`!!document.getElementById('nfc-host') && ${video}.readyState >= 1`)) break; await sleep(250); }
await sleep(1500);
await ev(`document.querySelector('.hint')?.remove(); document.querySelector('video').controls = false;`);
const seekTo = async (t) => ev(`(async()=>{const v=${video}; v.currentTime=${t}; await new Promise(r=>v.addEventListener('seeked',r,{once:true})); v.dispatchEvent(new Event('timeupdate'));})()`);
await seekTo(141); await ev(`${video}.play()`); await sleep(2500);
await ev(`[...${sh}.querySelectorAll('.cm')].find(r=>r.querySelector('.txt').textContent.includes('turning point'))?.querySelector('[data-act=toggle]')?.click()`); await sleep(600);
await shot('1-live');
await ev(`${sh}.querySelector('.tab[data-tab=top]').click()`); await sleep(500); await shot('2-top');
await ev(`${sh}.querySelector('.tab[data-tab=live]').click(); ${sh}.querySelector('textarea').focus()`); await sleep(200);
await ev(`(()=>{const ta=${sh}.querySelector('textarea'); ta.value='ok the eyebrow thing is actually incredible'; ta.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(300); await shot('3-compose');
await ev(`${sh}.querySelector('textarea').blur(); ${sh}.querySelector('.close').click()`); await seekTo(139.5); await ev(`${video}.play()`); await sleep(3500); await shot('4-popups');
await seekTo(10); await sleep(300); await ev(`${sh}.querySelector('.pill').click()`); await sleep(600); await shot('5-spoiler-guard');
process.exit(0);
