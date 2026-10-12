// Shadow-DOM overlay: toggle pill, right-hand drawer (timeline strip, Live/Top/New tabs, composer),
// and floating toasts for comments the playhead passes.
(() => {
  const NFC = window.NFC;
  const { esc, fmtTime, timeAgo, compact, avatarColor, initial } = NFC;
  const store = NFC.store;

  const ICON = {
    chat: '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M12 5c5 0 9 4 10.5 7-1.5 3-5.5 7-10.5 7S3 15 1.5 12C3 9 7 5 12 5zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M2.3 3.7 3.7 2.3l18 18-1.4 1.4-3.3-3.3C15.5 19.3 13.8 19.7 12 19.7 7 19.7 3 15.7 1.5 12.7c.8-1.6 2.2-3.4 4-4.9zM12 5.3c5 0 9 4 10.5 7.4-.6 1.2-1.5 2.5-2.7 3.7l-2.6-2.6a3.8 3.8 0 0 0-4.5-4.5L9.9 6.5c.7-.8 1.4-1.2 2.1-1.2z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.3 4.3 12.6a4.6 4.6 0 0 1 6.5-6.5L12 7.3l1.2-1.2a4.6 4.6 0 0 1 6.5 6.5z"/></svg>',
  };
  const NOW_WINDOW = 12;     // seconds after a comment's t that it counts as "happening now"
  const SPOILER_GRACE = 3;   // seconds ahead of the playhead still shown
  const TOAST_MS = 6000, MAX_TOASTS = 3;

  class UI {
    constructor() {
      this.host = document.createElement('div');
      this.host.id = 'nfc-host';
      this.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
      this.sh = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = NFC.CSS; this.sh.appendChild(style);
      this.root = document.createElement('div'); this.root.className = 'root'; this.sh.appendChild(this.root);
      this.root.innerHTML = this.skeleton();
      this.$ = (sel) => this.root.querySelector(sel);
      this.el = {
        pill: this.$('.pill'), pillN: this.$('.pill .n'), pillLive: this.$('.pill .live'),
        drawer: this.$('.drawer'), name: this.$('.name'), sub: this.$('.sub'),
        spoiler: this.$('.spoiler'), strip: this.$('.strip'), hist: this.$('.hist'), play: this.$('.play'), tt: this.$('.tt'),
        tNow: this.$('.t-now'), tEnd: this.$('.t-end'), tabs: this.$('.tabs'), list: this.$('.list'),
        at: this.$('.at'), replyto: this.$('.replyto'), ta: this.$('textarea'), send: this.$('.send'), toasts: this.$('.toasts'),
      };
      this.tab = 'live';
      this.title = null;
      this.video = null;
      this.now = 0; this.duration = 0;
      this.composeT = null;          // frozen timestamp while composing
      this.replyTo = null;           // comment being replied to
      this.expanded = new Set();     // comment ids with replies shown
      this.showAhead = false;        // spoiler guard override for this title
      this.userScrolledAt = 0;
      this.toasted = new Set();
      this.lastSig = '';
      this.pausedByUs = false;
      this.bind();
      this.applySettings();
      this.mount();
    }

    skeleton() {
      return `
<button class="pill" title="Show comments (Shift+C)">${ICON.chat.replace('<svg', '<svg class="ic"')}<span class="n">0</span><span class="live">LIVE</span></button>
<div class="drawer">
  <div class="hdr">
    <div class="ttl"><div class="name">Netflix Comments</div><div class="sub">loading…</div></div>
    <button class="ib spoiler on" title="Spoiler guard: hiding comments ahead of you">${ICON.eye}</button>
    <button class="ib close" title="Hide (Shift+C)">${ICON.close}</button>
  </div>
  <div class="strip" title="Comment density. Click to seek."><div class="hist"></div><div class="play"></div><div class="tt">0:00</div></div>
  <div class="times"><span class="t-now">0:00</span><span class="t-end">0:00</span></div>
  <div class="tabs">
    <button class="tab on" data-tab="live">Live</button>
    <button class="tab" data-tab="top">Top</button>
    <button class="tab" data-tab="new">New</button>
  </div>
  <div class="list"></div>
  <div class="comp">
    <div class="row1"><span class="at">0:00</span><span class="replyto"></span><span class="who-am-i"></span></div>
    <div class="box"><textarea rows="1" placeholder="Say something about this moment…" maxlength="1000"></textarea><button class="send" disabled>Post</button></div>
    <div class="hint"><kbd>Shift</kbd>+<kbd>C</kbd> toggle · <kbd>Enter</kbd> post · <kbd>Esc</kbd> cancel</div>
  </div>
</div>
<div class="toasts"></div>`;
    }

    mount() {
      const parent = document.fullscreenElement || document.body;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    bind() {
      // Keep keystrokes inside the overlay away from Netflix's player hotkeys (space, arrows, F, M…).
      for (const type of ['keydown', 'keyup', 'keypress']) this.host.addEventListener(type, (e) => e.stopPropagation());

      this.el.pill.addEventListener('click', () => this.setOpen(true));
      this.$('.close').addEventListener('click', () => this.setOpen(false));
      this.el.spoiler.addEventListener('click', () => { this.showAhead = !this.showAhead; this.renderSpoilerBtn(); this.renderList(true); });
      this.el.tabs.addEventListener('click', (e) => {
        const b = e.target.closest('.tab'); if (!b) return;
        this.tab = b.dataset.tab;
        for (const t of this.el.tabs.querySelectorAll('.tab')) t.classList.toggle('on', t === b);
        this.renderList(true);
        this.el.list.scrollTop = 0;
      });
      this.el.strip.addEventListener('mousemove', (e) => {
        const r = this.el.strip.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        this.el.tt.style.left = (f * 100) + '%'; this.el.tt.textContent = fmtTime(f * this.duration);
      });
      this.el.strip.addEventListener('click', (e) => {
        const r = this.el.strip.getBoundingClientRect();
        this.seek(((e.clientX - r.left) / r.width) * this.duration);
      });
      for (const t of ['wheel', 'touchmove', 'mousedown']) this.el.list.addEventListener(t, () => { this.userScrolledAt = Date.now(); }, { passive: true });
      this.el.list.addEventListener('click', (e) => this.onListClick(e));
      this.el.toasts.addEventListener('click', (e) => {
        const t = e.target.closest('.toast'); if (!t) return;
        this.setOpen(true); this.tab = 'live'; this.renderList(true);
        this.scrollTo(t.dataset.id);
      });

      const ta = this.el.ta;
      // Start composing on focus, first keystroke or click: whichever comes first freezes the timestamp.
      ta.addEventListener('focus', () => this.beginCompose());
      ta.addEventListener('mousedown', () => this.beginCompose());
      ta.addEventListener('input', () => {
        if (this.composeT == null) this.beginCompose();
        this.el.send.disabled = !ta.value.trim();
        ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
        if (e.key === 'Escape') { e.preventDefault(); this.cancelCompose(); }
      });
      this.el.send.addEventListener('click', () => this.submit());
      this.el.replyto.addEventListener('click', (e) => { if (e.target.closest('button')) this.setReply(null); });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'C' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) {
          e.preventDefault(); e.stopPropagation();
          if (!this.open) { this.setOpen(true); this.el.ta.focus(); }
          else if (this.sh.activeElement === this.el.ta) this.setOpen(false);
          else this.el.ta.focus();
        }
      }, true);
      document.addEventListener('fullscreenchange', () => this.mount());

      store.onChange((what) => {
        if (what === 'settings') this.applySettings();
        if (what === 'data' || what === 'title' || what === 'outbox') { this.renderHeader(); this.renderStrip(); this.renderList(); }
      });
    }

    // ---------- state ----------
    get open() { return !this.el.drawer.classList.contains('hide'); }
    setOpen(v) {
      this.el.drawer.classList.toggle('hide', !v);
      this.el.pill.classList.toggle('hide', v);
      store.saveSettings({ panelOpen: v });
      if (v) this.renderList(true);
    }
    applySettings() {
      const s = store.settings;
      this.$('.who-am-i').textContent = 'as ' + store.displayName();
      if (this.el.drawer.classList.contains('hide') === !!s.panelOpen) {
        this.el.drawer.classList.toggle('hide', !s.panelOpen);
        this.el.pill.classList.toggle('hide', !!s.panelOpen);
      }
      this.renderSpoilerBtn();
      this.renderList(true);
    }
    spoilerOn() { return store.settings.spoilerGuard && !this.showAhead; }
    renderSpoilerBtn() {
      const on = this.spoilerOn();
      this.el.spoiler.classList.toggle('on', on);
      this.el.spoiler.innerHTML = on ? ICON.eye : ICON.eyeOff;
      this.el.spoiler.title = on ? 'Spoiler guard ON: comments ahead of you are hidden. Click to show them.' : 'Spoiler guard OFF: showing comments ahead of you. Click to hide them.';
    }

    setTitle(title, video) {
      this.title = title; this.video = video;
      this.expanded.clear(); this.toasted.clear(); this.showAhead = false; this.lastSig = '';
      this.setReply(null);
      this.renderSpoilerBtn(); this.renderHeader(); this.renderStrip(); this.renderList(true);
    }
    setVideo(video) { this.video = video; }

    /** called on every timeupdate */
    tick(now, duration) {
      this.now = now;
      if (Number.isFinite(duration) && duration > 0) this.duration = duration;
      else if (this.title?.meta?.duration) this.duration = this.title.meta.duration;
      this.el.tNow.textContent = fmtTime(now); this.el.tEnd.textContent = fmtTime(this.duration);
      if (this.duration) this.el.play.style.left = Math.min(100, (now / this.duration) * 100) + '%';
      if (this.composeT == null) this.el.at.textContent = fmtTime(now);
      this.renderStripProgress();
      this.renderList();
      this.maybeToast();
      this.el.pillLive.classList.toggle('on', this.visible().some((c) => c.parentId == null && now - c.t >= 0 && now - c.t < NOW_WINDOW));
    }

    seek(t) {
      if (!this.video || !Number.isFinite(t)) return;
      try { this.video.currentTime = Math.max(0, Math.min(this.duration || t, t)); } catch (e) { NFC.log('seek failed', e); }
    }

    // ---------- data views ----------
    visible() {
      if (!this.title) return [];
      const all = this.title.all();
      if (!this.spoilerOn()) return all;
      return all.filter((c) => c.t <= this.now + SPOILER_GRACE || c.pending);
    }
    hiddenCount() {
      if (!this.title || !this.spoilerOn()) return 0;
      return this.title.all().filter((c) => c.parentId == null && c.t > this.now + SPOILER_GRACE && !c.pending).length;
    }

    // ---------- rendering ----------
    renderHeader() {
      const t = this.title; if (!t) return;
      const m = t.meta;
      this.el.name.textContent = m?.name || t.name || `Title ${t.videoId}`;
      const parts = [];
      parts.push(`${compact(m?.count ?? 0)} comment${(m?.count ?? 0) === 1 ? '' : 's'}`);
      if (t.offline) parts.push('<span class="warn">offline · showing cached</span>');
      else if (m?.generatedAt) parts.push(`synced ${timeAgo(m.generatedAt)}`);
      this.el.sub.innerHTML = parts.join(' · ');
      this.el.pillN.textContent = compact(m?.count ?? 0);
    }

    renderStrip() {
      const hist = this.title?.meta?.hist ?? [];
      const max = Math.max(1, ...hist);
      if (this.el.hist.childElementCount !== hist.length) {
        this.el.hist.innerHTML = hist.map(() => '<i></i>').join('');
      }
      const bars = this.el.hist.children;
      for (let i = 0; i < hist.length; i++) {
        const h = hist[i] ? 6 + Math.round((hist[i] / max) * 36) : 2;
        bars[i].style.height = h + 'px';
        bars[i].classList.toggle('hot', hist[i] >= max * 0.8 && hist[i] > 2);
      }
      this.renderStripProgress();
    }
    renderStripProgress() {
      const hs = this.title?.meta?.histSeconds ?? 10;
      const idx = Math.floor(this.now / hs);
      const bars = this.el.hist.children;
      for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('past', i <= idx);
    }

    renderList(force = false) {
      if (!this.title || !this.open) return;
      const now = this.now;
      const vis = this.visible();
      const top = vis.filter((c) => c.parentId == null);
      const replies = new Map();
      for (const c of vis) if (c.parentId != null) { if (!replies.has(c.parentId)) replies.set(c.parentId, []); replies.get(c.parentId).push(c); }

      let items;
      if (this.tab === 'top') items = top.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || (b.replyCount ?? 0) - (a.replyCount ?? 0) || a.t - b.t);
      else if (this.tab === 'new') items = top.sort((a, b) => b.createdAt - a.createdAt);
      else items = top.sort((a, b) => a.t - b.t || a.createdAt - b.createdAt);

      const nowIds = new Set(this.tab === 'live' ? items.filter((c) => now - c.t >= 0 && now - c.t < NOW_WINDOW).map((c) => c.id) : []);
      const hidden = this.hiddenCount();
      const sig = this.tab + '|' + items.map((c) => `${c.id}:${c.likeCount}:${c.liked ? 1 : 0}:${c.replyCount}:${c.pending ? 1 : 0}:${c.failed ? 1 : 0}:${this.expanded.has(c.id) ? 1 : 0}`).join(',') + '|' + [...nowIds].join(',') + '|' + hidden + '|' + [...replies.values()].flat().map((r) => r.id + ':' + r.likeCount).join(',');
      if (!force && sig === this.lastSig) return;
      this.lastSig = sig;

      let html = '';
      if (!items.length) {
        const m = this.title.meta;
        html = `<div class="empty">${!m ? 'Loading comments…' : hidden ? `<b>${hidden}</b> comment${hidden === 1 ? '' : 's'} ahead of you.<br>Keep watching, or turn off the spoiler guard.` : this.title.offline ? 'Server unreachable and nothing cached yet.' : '<b>Nothing here yet.</b><br>Be the first — pause on a moment and say something.'}</div>`;
      } else {
        let lastNow = null;
        for (const c of items) {
          const isNow = nowIds.has(c.id);
          if (this.tab === 'live' && isNow !== lastNow) {
            if (isNow) html += '<div class="divider">happening now</div>';
            else if (lastNow === true) html += '<div class="divider">earlier</div>';
            lastNow = isNow;
          }
          html += this.renderComment(c, isNow);
          if (this.expanded.has(c.id)) for (const r of (replies.get(c.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)) html += this.renderComment(r, false, true);
        }
      }
      if (hidden && items.length) html += `<div class="hidden-row"><span>${hidden} comment${hidden === 1 ? '' : 's'} ahead of you hidden</span><button data-act="showahead">Show anyway</button></div>`;
      this.el.list.innerHTML = html;
      if (this.tab === 'live' && Date.now() - this.userScrolledAt > 6000 && nowIds.size) {
        const last = [...nowIds].pop();
        const el = this.el.list.querySelector(`.cm[data-id="${last}"]`);
        if (el) this.el.list.scrollTop = Math.max(0, el.offsetTop + el.offsetHeight - this.el.list.clientHeight * 0.66);
      }
    }

    renderComment(c, isNow, isReply = false) {
      const cls = ['cm', isNow && 'now', c.pending && 'pending', c.failed && 'failed', isReply && 'reply'].filter(Boolean).join(' ');
      const status = c.pending ? ' · sending…' : c.failed ? ` · failed: ${esc(c.failed)}` : '';
      const canAct = !String(c.id).startsWith('local-');
      return `
<div class="${cls}" data-id="${esc(c.id)}">
  <div class="av" style="background:${avatarColor(c.authorId)}">${esc(initial(c.authorName))}</div>
  <div class="bd">
    <div class="meta"><span class="who">${esc(c.authorName)}</span>${c.mine ? '<span class="you">you</span>' : ''}${isReply ? '' : `<button class="tpill" data-act="seek" data-t="${c.t}" title="Jump to ${fmtTime(c.t)}">${fmtTime(c.t)}</button>`}<span class="age">· ${timeAgo(c.createdAt)}${status}</span></div>
    <div class="txt">${esc(c.body)}</div>
    <div class="acts">
      <button class="like ${c.liked ? 'on' : ''}" data-act="like" ${canAct ? '' : 'disabled'}>${ICON.heart}<span>${compact(c.likeCount ?? 0)}</span></button>
      ${isReply ? '' : `<button data-act="reply" ${canAct ? '' : 'disabled'}>Reply</button>`}
      ${!isReply && c.replyCount ? `<button data-act="toggle">${this.expanded.has(c.id) ? 'Hide replies' : `View ${c.replyCount} repl${c.replyCount === 1 ? 'y' : 'ies'}`}</button>` : ''}
      ${c.mine ? '<button data-act="delete">Delete</button>' : ''}
    </div>
  </div>
</div>`;
    }

    onListClick(e) {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'showahead') { this.showAhead = true; this.renderSpoilerBtn(); this.renderList(true); return; }
      const row = b.closest('.cm'); const id = row?.dataset.id;
      const c = this.title.all().find((x) => String(x.id) === id);
      if (act === 'seek') this.seek(Number(b.dataset.t));
      else if (act === 'like' && c) this.title.toggleLike(c.id);
      else if (act === 'reply' && c) { this.setReply(c); this.el.ta.focus(); }
      else if (act === 'toggle' && c) {
        if (this.expanded.has(c.id)) this.expanded.delete(c.id); else { this.expanded.add(c.id); this.title.ensureBucket(NFC.bucketOf(c.t), true); }
        this.renderList(true);
      }
      else if (act === 'delete' && c) {
        if (b.dataset.confirm) this.title.remove(c.id);
        else { b.dataset.confirm = '1'; b.textContent = 'Really delete?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.textContent = 'Delete'; } }, 3000); }
      }
    }

    scrollTo(id) {
      this.el.list.querySelector(`.cm[data-id="${id}"]`)?.scrollIntoView({ block: 'center' });
    }

    // ---------- composer ----------
    beginCompose() {
      if (this.composeT == null) { this.composeT = this.replyTo ? this.replyTo.t : this.now; this.el.at.textContent = fmtTime(this.composeT); }
      if (store.settings.pauseOnCompose && this.video && !this.video.paused) {
        try { this.video.pause(); this.pausedByUs = true; } catch { /* ignore */ }
      }
    }
    endCompose() {
      this.composeT = null; this.el.at.textContent = fmtTime(this.now);
      this.el.ta.value = ''; this.el.ta.style.height = 'auto'; this.el.send.disabled = true;
      this.setReply(null);
      if (this.pausedByUs && this.video) { try { this.video.play(); } catch { /* ignore */ } }
      this.pausedByUs = false;
    }
    cancelCompose() { this.endCompose(); this.el.ta.blur(); }
    setReply(c) {
      this.replyTo = c;
      this.el.replyto.innerHTML = c ? `replying to <b>${esc(c.authorName)}</b> <button title="cancel reply">✕</button>` : '';
      if (c) { this.composeT = c.t; this.el.at.textContent = fmtTime(c.t); this.el.ta.placeholder = `Reply to ${c.authorName}…`; }
      else this.el.ta.placeholder = 'Say something about this moment…';
    }
    submit() {
      const body = this.el.ta.value.trim();
      if (!body || !this.title) return;
      const t = this.composeT ?? this.now;
      const parentId = this.replyTo?.id ?? null;
      if (parentId != null) this.expanded.add(parentId);
      this.title.post(t, body, parentId);
      this.endCompose();
      this.tab = 'live';
      for (const tb of this.el.tabs.querySelectorAll('.tab')) tb.classList.toggle('on', tb.dataset.tab === 'live');
      this.userScrolledAt = 0;
      this.renderList(true);
      this.el.ta.blur();
    }

    // ---------- toasts ----------
    maybeToast() {
      if (!store.settings.showToasts || !this.title) return;
      if (this.open && this.tab === 'live') return; // the live tab already highlights them
      const now = this.now;
      const due = this.visible().filter((c) => c.parentId == null && !this.toasted.has(c.id) && now - c.t >= 0 && now - c.t < 1.5);
      for (const c of due.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0)).slice(0, 2)) {
        this.toasted.add(c.id);
        this.toast(c);
      }
      // allow re-toasting after a seek backwards
      for (const id of this.toasted) { const c = this.title.all().find((x) => x.id === id); if (c && c.t > now + 2) this.toasted.delete(id); }
    }
    toast(c) {
      const el = document.createElement('div');
      el.className = 'toast'; el.dataset.id = c.id;
      el.innerHTML = `<div class="av" style="background:${avatarColor(c.authorId)}">${esc(initial(c.authorName))}</div><div><div class="who"><b>${esc(c.authorName)}</b> · ${fmtTime(c.t)}${c.likeCount ? ` · ♥ ${compact(c.likeCount)}` : ''}</div><div class="txt">${esc(c.body)}</div></div>`;
      this.el.toasts.appendChild(el);
      while (this.el.toasts.childElementCount > MAX_TOASTS) this.el.toasts.firstElementChild.remove();
      this.expireToast(el, TOAST_MS);
    }
    // A toast only counts down while the video plays, so pausing to read keeps it on screen.
    expireToast(el, ms) {
      setTimeout(() => {
        if (!el.isConnected) return;
        if (this.video?.paused) return this.expireToast(el, 500);
        el.classList.add('out'); setTimeout(() => el.remove(), 400);
      }, ms);
    }
  }

  function isTyping(e) {
    const t = e.composedPath()[0];
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  NFC.UI = UI;
})();
