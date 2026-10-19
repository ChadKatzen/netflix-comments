// Data layer. Designed for availability over consistency:
//  - reads come from CDN-cacheable snapshots (meta.json + 5-minute bucket files) and are cached locally
//  - your own posts/likes are applied locally first and merged over whatever snapshot we have
//  - writes go through an outbox that retries, so the drawer keeps working if the server is unreachable
(() => {
  const NFC = window.NFC;
  const S = NFC.storage;

  const DEFAULT_SETTINGS = {
    displayName: '',
    readBase: 'http://localhost:3131',
    writeBase: 'http://localhost:3131',
    spoilerGuard: true,
    showToasts: true,
    pauseOnCompose: true,
    panelOpen: true,
  };
  const META_TTL = 45_000, BUCKET_TTL = 60_000, MINE_TTL = 15 * 60_000, CACHE_TITLES = 25;

  const store = NFC.store = {
    settings: { ...DEFAULT_SETTINGS },
    user: null,
    listeners: new Set(),
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit(what) { for (const fn of this.listeners) try { fn(what); } catch (e) { console.error(e); } },

    async init() {
      const saved = await S.get('sync', 'settings', {});
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
      let user = await S.get('local', 'user', null);
      if (!user?.userId) {
        user = { userId: 'u_' + NFC.uuid().replace(/-/g, '').slice(0, 24), createdAt: Date.now() };
        await S.set('local', 'user', user);
      }
      this.user = user;
      if (!this.settings.displayName) {
        this.settings.displayName = 'viewer-' + user.userId.slice(2, 6);
        await S.set('sync', 'settings', this.settings);
      }
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.settings) {
          this.settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
          this.emit('settings');
        }
      });
      setInterval(() => outbox.flush(), 10_000);
      outbox.flush();
    },

    async saveSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      await S.set('sync', 'settings', this.settings);
    },

    displayName() { return this.settings.displayName || 'viewer'; },
    readUrl(path) { return this.settings.readBase.replace(/\/+$/, '') + '/' + path; },
    writeUrl(path) { return this.settings.writeBase.replace(/\/+$/, '') + path; },
  };

  // ---------- per-title state ----------
  class TitleState {
    constructor(videoId) {
      this.videoId = videoId;
      this.meta = null;
      this.metaAt = 0;
      this.buckets = new Map();   // bucket -> { comments, at }
      this.loading = new Set();
      this.mine = [];             // comments I authored recently (pending or acked), always merged in
      this.likes = {};            // id -> { liked, at }
      this.deleted = {};          // id -> at
      this.name = '';
      this.duration = null;
      this.reported = false;
      this.offline = false;
    }

    key() { return 'title:' + this.videoId; }

    async loadCached() {
      const c = await S.get('local', this.key(), null);
      if (!c) return;
      this.meta = c.meta ?? null;
      this.metaAt = 0; // cached meta is stale by definition; refetch soon
      for (const [b, v] of Object.entries(c.buckets ?? {})) this.buckets.set(Number(b), Array.isArray(v) ? { comments: v, at: 0, gen: 0 } : { comments: v.comments ?? [], at: 0, gen: v.gen ?? 0 });
      this.mine = (c.mine ?? []).filter((m) => m.pending || Date.now() - m.createdAt < MINE_TTL);
      this.likes = c.likes ?? {};
      this.deleted = c.deleted ?? {};
    }

    save = NFC.debounce(async () => {
      const buckets = {};
      for (const [b, v] of this.buckets) buckets[b] = { comments: v.comments, gen: v.gen ?? 0 };
      await S.set('local', this.key(), { meta: this.meta, buckets, mine: this.mine, likes: this.likes, deleted: this.deleted, savedAt: Date.now() });
      pruneCache();
    }, 500);

    async fetchMeta(force = false) {
      if (!force && Date.now() - this.metaAt < META_TTL) return;
      if (this.loading.has('meta')) return;
      this.loading.add('meta');
      try {
        const r = await NFC.http(store.readUrl(`t/${this.videoId}/meta.json`));
        if (r.ok) { this.meta = r.body; this.offline = false; }
        else if (r.status === 404) { this.offline = false; if (!this.meta) this.meta = emptyMeta(this.videoId); }
        else this.offline = !!r.error;
        if (!r.error) this.metaAt = Date.now();
        this.save();
        store.emit('data');
      } finally { this.loading.delete('meta'); }
    }

    async ensureBucket(b, force = false) {
      if (b < 0) return;
      const cur = this.buckets.get(b);
      if (!force && cur && Date.now() - cur.at < BUCKET_TTL) return;
      if (this.loading.has(b)) return;
      // Skip buckets the meta says are empty (saves a request); still honor local pending comments.
      if (this.meta && this.metaAt && !this.meta.bucketCounts?.[b] && !cur) {
        this.buckets.set(b, { comments: [], at: Date.now() });
        return;
      }
      this.loading.add(b);
      try {
        const r = await NFC.http(store.readUrl(`t/${this.videoId}/b/${b}.json`));
        if (r.ok) { this.buckets.set(b, { comments: r.body.comments ?? [], at: Date.now(), gen: r.body.generatedAt ?? Date.now() }); this.offline = false; }
        else if (r.status === 404) this.buckets.set(b, { comments: [], at: Date.now() });
        else this.offline = !!r.error;
        this.save();
        store.emit('data');
      } finally { this.loading.delete(b); }
    }

    /** Merged, de-duplicated view with local overlays applied. */
    all() {
      // Each copy of a comment remembers when its snapshot was generated (_gen). Buckets and meta.json are
      // separate files rendered at different times, so a like must be overlaid per copy, not per title.
      const byId = new Map();
      const put = (c, gen) => {
        const cur = byId.get(c.id);
        if (!cur || gen > cur._gen) byId.set(c.id, { ...c, _gen: gen }); // prefer the freshest copy
      };
      for (const v of this.buckets.values()) v.comments.forEach((c) => put(c, v.gen ?? 0));
      const metaGen = this.meta?.generatedAt ?? 0;
      (this.meta?.top ?? []).forEach((c) => put(c, metaGen));
      (this.meta?.newest ?? []).forEach((c) => put(c, metaGen));
      const gen = metaGen;
      for (const m of this.mine) {
        if (!byId.has(m.id)) byId.set(m.id, { ...m, mine: true, _gen: m.ackedAt ?? Infinity });
        else byId.get(m.id).mine = true;
      }
      const out = [];
      for (const c of byId.values()) {
        if (this.deleted[c.id]) continue;
        if (c.authorId === store.user.userId) c.mine = true;
        const lk = this.likes[c.id];
        if (lk) {
          c.liked = lk.liked;
          if (lk.at > c._gen) c.likeCount = Math.max(0, (c.likeCount ?? 0) + (lk.liked ? 1 : -1)); // this copy predates my action
        }
        delete c._gen;
        out.push(c);
      }
      // reply counts: trust snapshot, but add local pending replies
      const extra = {};
      for (const m of this.mine) if (m.parentId != null && (m.pending || m.createdAt > gen)) extra[m.parentId] = (extra[m.parentId] ?? 0) + 1;
      for (const c of out) if (extra[c.id]) c.replyCount = (c.replyCount ?? 0) + extra[c.id];
      return out;
    }

    // ---- writes (optimistic) ----
    post(t, body, parentId = null) {
      const c = {
        id: 'local-' + NFC.uuid(), parentId, t, body,
        authorId: store.user.userId, authorName: store.displayName(),
        createdAt: Date.now(), likeCount: 0, replyCount: 0, pending: true, mine: true,
      };
      this.mine.push(c);
      this.save();
      outbox.push({ kind: 'comment', videoId: this.videoId, tempId: c.id, payload: { t, body, parentId, authorId: c.authorId, authorName: c.authorName } });
      store.emit('data');
      return c;
    }

    toggleLike(id) {
      if (String(id).startsWith('local-')) return;
      const cur = this.likes[id]?.liked ?? false;
      this.likes[id] = { liked: !cur, at: Date.now() };
      this.save();
      outbox.push({ kind: 'like', videoId: this.videoId, payload: { id, userId: store.user.userId } });
      store.emit('data');
    }

    remove(id) {
      this.deleted[id] = Date.now();
      this.mine = this.mine.filter((m) => m.id !== id);
      this.save();
      if (!String(id).startsWith('local-')) outbox.push({ kind: 'delete', videoId: this.videoId, payload: { id, userId: store.user.userId } });
      else outbox.drop((op) => op.tempId === id);
      store.emit('data');
    }

    ack(tempId, serverComment) {
      const i = this.mine.findIndex((m) => m.id === tempId);
      if (i >= 0) this.mine[i] = { ...serverComment, mine: true, ackedAt: Date.now() };
      this.save();
      store.emit('data');
    }

    fail(tempId, error) {
      const m = this.mine.find((x) => x.id === tempId);
      if (m) { m.pending = false; m.failed = error; }
      this.save();
      store.emit('data');
    }

    async reportTitle(name, duration) {
      if (this.reported) return;
      if (!name && !duration) return;
      this.reported = true;
      this.name = name; this.duration = duration;
      outbox.push({ kind: 'title', videoId: this.videoId, payload: { name, duration } });
    }
  }

  function emptyMeta(videoId) {
    return { videoId, name: '', duration: null, count: 0, totalWithReplies: 0, bucketSeconds: NFC.BUCKET_SECONDS, bucketCounts: {}, histSeconds: 10, hist: [], top: [], newest: [], generatedAt: 0 };
  }

  async function pruneCache() {
    const all = await new Promise((r) => chrome.storage.local.get(null, r));
    const titles = Object.entries(all).filter(([k]) => k.startsWith('title:')).sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0));
    for (const [k] of titles.slice(CACHE_TITLES)) chrome.storage.local.remove(k);
  }

  store.current = null;
  store.loadTitle = async (videoId) => {
    if (store.current?.videoId === videoId) return store.current;
    const ts = new TitleState(videoId);
    await ts.loadCached();
    store.current = ts;
    store.emit('title');
    ts.fetchMeta(true);
    return ts;
  };

  // ---------- outbox ----------
  const outbox = store.outbox = {
    busy: false,
    async list() { return S.get('local', 'outbox', []); },
    async push(op) {
      const ops = await this.list();
      ops.push({ ...op, id: NFC.uuid(), createdAt: Date.now(), attempts: 0 });
      await S.set('local', 'outbox', ops);
      this.flush();
    },
    async drop(pred) {
      const ops = await this.list();
      await S.set('local', 'outbox', ops.filter((op) => !pred(op)));
    },
    async flush() {
      if (this.busy) return;
      this.busy = true;
      try {
        let ops = await this.list();
        const keep = [];
        for (const op of ops) {
          const done = await this.send(op);
          if (!done) keep.push(op);
        }
        await S.set('local', 'outbox', keep);
        store.emit('outbox', keep.length);
      } finally { this.busy = false; }
    },
    /** returns true when the op is finished (success or permanently failed) */
    async send(op) {
      const cur = store.current?.videoId === op.videoId ? store.current : null;
      op.attempts++;
      let r;
      if (op.kind === 'comment') {
        // a reply to a comment that is itself still pending can't be sent yet
        if (op.payload.parentId != null && String(op.payload.parentId).startsWith('local-')) {
          const parent = cur?.mine.find((m) => m.id === op.payload.parentId);
          return !parent && op.attempts > 30; // give up only after the parent is long gone
        }
        r = await NFC.http(store.writeUrl(`/api/titles/${op.videoId}/comments`), 'POST', op.payload);
        if (r.ok) { cur ? cur.ack(op.tempId, r.body) : ackInStorage(op.videoId, op.tempId, r.body); return true; }
      } else if (op.kind === 'like') {
        r = await NFC.http(store.writeUrl(`/api/comments/${op.payload.id}/like`), 'POST', { userId: op.payload.userId });
        if (r.ok && cur) {
          // server tells us the real state; reconcile our optimistic toggle
          const lk = cur.likes[op.payload.id];
          if (lk && lk.liked !== r.body.liked) { cur.likes[op.payload.id] = { liked: r.body.liked, at: Date.now() }; cur.save(); store.emit('data'); }
        }
        if (r.ok) return true;
      } else if (op.kind === 'delete') {
        r = await NFC.http(store.writeUrl(`/api/comments/${op.payload.id}?user=${encodeURIComponent(op.payload.userId)}`), 'DELETE');
        if (r.ok || r.status === 404) return true;
      } else if (op.kind === 'title') {
        r = await NFC.http(store.writeUrl(`/api/titles/${op.videoId}`), 'PUT', op.payload);
        if (r.ok) return true;
      }
      if (r?.error) { if (cur) { cur.offline = true; store.emit('data'); } return false; } // network/permission: retry later
      if (r && r.status >= 400 && r.status !== 429 && r.status < 500) {
        if (op.kind === 'comment') cur ? cur.fail(op.tempId, r.body?.error || `rejected (${r.status})`) : null;
        return true; // permanent rejection
      }
      return op.attempts > 50; // 5xx/429: retry, but not forever
    },
  };

  async function ackInStorage(videoId, tempId, serverComment) {
    const key = 'title:' + videoId;
    const c = await S.get('local', key, null);
    if (!c) return;
    c.mine = (c.mine ?? []).map((m) => (m.id === tempId ? { ...serverComment, mine: true } : m));
    await S.set('local', key, c);
  }
})();
