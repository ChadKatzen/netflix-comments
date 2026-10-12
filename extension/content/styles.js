// Styles injected into the shadow root (content_scripts CSS can't reach inside a shadow DOM).
window.NFC = window.NFC || {};
window.NFC.CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #f2f2f2; --red: #e50914; --bg: rgba(18,18,20,.92); --bg2: rgba(255,255,255,.06); --bg3: rgba(255,255,255,.11); --line: rgba(255,255,255,.10); --muted: #9a9a9a; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--red); outline-offset: 1px; }

/* toggle pill (drawer closed) */
.pill { pointer-events: auto; position: absolute; right: 0; top: 45%; transform: translateY(-50%); background: var(--bg); backdrop-filter: blur(14px); border: 1px solid var(--line); border-right: 0; border-radius: 14px 0 0 14px; padding: 10px 12px 10px 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; box-shadow: 0 6px 24px rgba(0,0,0,.4); transition: background .15s; }
.pill:hover { background: rgba(30,30,34,.96); }
.pill .n { font-weight: 700; font-size: 13px; }
.pill .ic { width: 22px; height: 22px; fill: #fff; }
.pill .live { position: absolute; top: -6px; left: -6px; background: var(--red); color: #fff; font-size: 10px; font-weight: 700; border-radius: 10px; padding: 1px 6px; display: none; }
.pill .live.on { display: block; }

/* drawer */
.drawer { pointer-events: auto; position: absolute; top: 12px; right: 12px; bottom: 92px; width: 380px; max-width: calc(100vw - 24px); display: flex; flex-direction: column; background: var(--bg); backdrop-filter: blur(18px); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.55); overflow: hidden; }
.hdr { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 16px; }
.hdr .ttl { flex: 1; min-width: 0; }
.hdr .name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hdr .sub { color: var(--muted); font-size: 12px; margin-top: 1px; }
.hdr .sub .warn { color: #ffb74d; }
.ib { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: #ddd; }
.ib:hover { background: var(--bg3); }
.ib svg { width: 18px; height: 18px; fill: currentColor; }
.ib.on { color: var(--red); }

/* timeline strip (SoundCloud-ish) */
.strip { position: relative; margin: 2px 16px 6px; height: 44px; cursor: pointer; }
.hist { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 1px; }
.hist i { flex: 1; min-width: 1px; background: rgba(255,255,255,.22); border-radius: 1px 1px 0 0; height: 2px; transition: background .2s; }
.hist i.past { background: rgba(229,9,20,.75); }
.hist i.hot { background: #fff; }
.play { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; box-shadow: 0 0 6px #fff; left: 0; }
.play::after { content: ''; position: absolute; top: -4px; left: -4px; width: 10px; height: 10px; border-radius: 50%; background: #fff; }
.strip .tt { position: absolute; top: -26px; transform: translateX(-50%); background: #fff; color: #000; font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 6px; white-space: nowrap; display: none; }
.strip:hover .tt { display: block; }
.times { display: flex; justify-content: space-between; margin: 0 16px 4px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

/* tabs */
.tabs { display: flex; gap: 4px; padding: 4px 12px 0; border-bottom: 1px solid var(--line); }
.tab { padding: 8px 12px; color: var(--muted); font-weight: 600; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 6px 6px 0 0; }
.tab:hover { color: #fff; background: var(--bg2); }
.tab.on { color: #fff; border-bottom-color: var(--red); }
.tab .c { color: var(--muted); font-weight: 500; margin-left: 4px; font-size: 12px; }

/* list */
.list { flex: 1; overflow-y: auto; padding: 6px 8px 8px; scroll-behavior: smooth; }
.list::-webkit-scrollbar { width: 8px; } .list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 4px; }
.empty { color: var(--muted); text-align: center; padding: 36px 16px; line-height: 1.6; }
.empty b { color: #fff; }
.cm { display: flex; gap: 10px; padding: 10px 8px; border-radius: 12px; transition: background .25s; position: relative; }
.cm:hover { background: var(--bg2); }
.cm.now { background: rgba(229,9,20,.14); }
.cm.now::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 2px; background: var(--red); }
.cm.pending { opacity: .6; }
.cm.failed .meta { color: #ff6b6b; }
.cm.reply { padding-left: 46px; }
.av { width: 34px; height: 34px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #fff; }
.cm.reply .av { width: 26px; height: 26px; font-size: 11px; }
.bd { flex: 1; min-width: 0; }
.meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.meta .who { color: #fff; font-weight: 600; }
.meta .age { color: #777; }
.meta .you { background: var(--bg3); color: #fff; font-size: 10px; padding: 0 5px; border-radius: 4px; font-weight: 600; }
.tpill { background: var(--bg3); color: #fff; font-variant-numeric: tabular-nums; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px; }
.tpill:hover { background: var(--red); }
.txt { margin-top: 3px; white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }
.acts { display: flex; align-items: center; gap: 14px; margin-top: 6px; font-size: 12px; color: var(--muted); }
.acts button:hover { color: #fff; }
.like { display: inline-flex; align-items: center; gap: 4px; }
.like svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; }
.like.on { color: var(--red); } .like.on svg { fill: var(--red); stroke: var(--red); }
.hidden-row { margin: 6px 8px; padding: 10px 12px; border-radius: 10px; background: var(--bg2); color: var(--muted); font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hidden-row button { color: #fff; font-weight: 600; }
.divider { text-align: center; color: var(--muted); font-size: 11px; margin: 8px 0 2px; letter-spacing: .04em; text-transform: uppercase; }

/* composer */
.comp { border-top: 1px solid var(--line); padding: 10px 12px 12px; background: rgba(0,0,0,.25); }
.comp .row1 { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.comp .at { background: var(--red); color: #fff; font-weight: 700; padding: 2px 9px; border-radius: 10px; font-variant-numeric: tabular-nums; }
.comp .replyto { flex: 1; display: flex; align-items: center; gap: 6px; }
.comp .replyto button { color: #fff; }
.comp .box { display: flex; gap: 8px; align-items: flex-end; }
textarea { flex: 1; resize: none; min-height: 40px; max-height: 120px; background: var(--bg3); border: 1px solid transparent; border-radius: 12px; color: #fff; padding: 10px 12px; font: inherit; }
textarea::placeholder { color: var(--muted); }
textarea:focus { border-color: rgba(255,255,255,.3); }
.send { background: var(--red); color: #fff; font-weight: 700; border-radius: 10px; padding: 0 14px; height: 40px; }
.send:disabled { opacity: .4; cursor: default; }
.hint { font-size: 11px; color: var(--muted); margin-top: 6px; }
kbd { background: var(--bg3); border-radius: 4px; padding: 0 5px; font: 11px ui-monospace, Menlo, monospace; }

/* toasts (SoundCloud-style passing comments) */
.toasts { position: absolute; left: 24px; bottom: 130px; display: flex; flex-direction: column; gap: 8px; max-width: min(360px, 36vw); }
.toast { pointer-events: auto; display: flex; gap: 10px; align-items: flex-start; background: var(--bg); backdrop-filter: blur(14px); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; box-shadow: 0 8px 28px rgba(0,0,0,.45); animation: pop .25s ease-out; cursor: pointer; }
.toast.out { animation: fade .4s ease-in forwards; }
.toast .pin { font-size: 10px; color: var(--muted); margin-top: 3px; }
.toast .av { width: 28px; height: 28px; font-size: 12px; }
.toast .who { font-size: 12px; color: var(--muted); }
.toast .who b { color: #fff; }
.toast .txt { margin-top: 1px; font-size: 14px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
@keyframes pop { from { transform: translateY(12px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fade { to { opacity: 0; transform: translateY(-8px); } }
.hide { display: none !important; }
`;
