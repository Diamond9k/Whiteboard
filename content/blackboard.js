/*
 * content/blackboard.js — runs on https://learn.uark.edu/* (top frame only).
 *
 * Pulls the signed-in student's real data from Blackboard's REST API using the page's own
 * signed-in session (same-origin fetch, credentials:'include'), normalizes it
 * with shared/normalize.js (globalThis.BBX) and hands it to the background
 * service worker, which is the only writer to chrome.storage.local.
 *
 * READ-ONLY: every request goes through getJSON(), which hard-codes GET.
 * DEFENSIVE: every fetch/parse is wrapped; failures become section states
 * ('auth' | 'forbidden' | 'not-found' | 'error'), never guessed values.
 * Falls back to scraping the Ultra course list DOM only if the API fails.
 */
(() => {
  'use strict';
  if (window.top !== window) return;               // top frame only
  if (window.__bbxBlackboardLoaded) return;        // guard against double injection
  window.__bbxBlackboardLoaded = true;

  const BBX = globalThis.BBX;
  if (!BBX) { console.warn('[BBX] normalize module missing; aborting'); return; }

  const MIN_INTERVAL_MS = 15 * 60 * 1000;          // auto-sync at most every 15 min
  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_PAGES = 20;
  const MAX_DETAIL_COURSES = 15;
  const CONCURRENCY = 2;
  const log = (...a) => console.debug('[BBX blackboard]', ...a);

  let syncing = false;

  // ------------------------------------------------------------ messaging
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) { log('sendMessage error', chrome.runtime.lastError.message); resolve(null); return; }
          resolve(resp || null);
        });
      } catch (e) { log('sendMessage threw', e); resolve(null); } // extension reloaded / context invalidated
    });
  }
  const reportStatus = (state, extra = {}) => send({ type: 'bbx:status', system: 'blackboard', status: { state, at: new Date().toISOString(), ...extra } });

  // --------------------------------------------------------------- HTTP
  class HttpError extends Error {
    constructor(kind, status, url) { super(`${kind} (${status}) ${url}`); this.kind = kind; this.status = status; }
  }

  /** GET-only JSON fetch with timeout + login-redirect detection. */
  async function getJSON(path) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new HttpError('cross-origin-blocked', 0, path);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url.href, {
        method: 'GET',                       // read-only, always
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new HttpError(e && e.name === 'AbortError' ? 'timeout' : 'network', 0, url.pathname);
    } finally { clearTimeout(timer); }

    const ct = res.headers.get('content-type') || '';
    if (res.redirected && !/\/learn\/api\//.test(new URL(res.url).pathname)) throw new HttpError('auth', res.status, url.pathname);
    if (res.status === 401) throw new HttpError('auth', 401, url.pathname);
    if (res.status === 403) throw new HttpError('forbidden', 403, url.pathname);
    if (res.status === 404) throw new HttpError('not-found', 404, url.pathname);
    if (!res.ok) throw new HttpError('error', res.status, url.pathname);
    if (!/json/i.test(ct)) throw new HttpError(/html/i.test(ct) ? 'auth' : 'bad-content-type', res.status, url.pathname); // login page served as 200
    try { return await res.json(); } catch (_) { throw new HttpError('bad-json', res.status, url.pathname); }
  }

  /** Follow paging.nextPage (same-origin, relative) and concatenate results. */
  async function getAll(path) {
    let next = path, pages = 0;
    const all = [];
    while (next && pages < MAX_PAGES) {
      const body = await getJSON(next);
      if (Array.isArray(body && body.results)) all.push(...body.results);
      else if (Array.isArray(body)) all.push(...body);
      const np = body && body.paging && typeof body.paging.nextPage === 'string' ? body.paging.nextPage : null;
      next = np && np.startsWith('/') ? np : null;
      pages++;
    }
    return all;
  }

  /** Try candidate endpoints in order; return { data, path } or throw the most meaningful error. */
  async function firstOk(candidates, fn = getJSON) {
    let lastErr = null;
    const kinds = [];
    for (const p of candidates) {
      try { return { data: await fn(p), path: p }; } catch (e) { lastErr = e; kinds.push(e.kind); log('candidate failed', p, e.message); }
    }
    // Only call it an auth failure if EVERY candidate said auth.
    const err = lastErr || new HttpError('error', 0, 'no candidates');
    err.kind = kinds.length && kinds.every((k) => k === 'auth') ? 'auth' : (kinds.includes('forbidden') ? 'forbidden' : err.kind);
    throw err;
  }

  /** Wrap a section fetch: { state, data?, error?, syncedAt }. Never throws. */
  async function sectionFetch(candidates, fn) {
    try {
      const { data } = await firstOk(candidates, fn);
      return { state: 'ok', data, syncedAt: new Date().toISOString() };
    } catch (e) {
      return { state: e.kind || 'error', error: e.message, syncedAt: new Date().toISOString() };
    }
  }

  async function pool(items, n, worker) {
    const out = new Array(items.length);
    let i = 0;
    const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await worker(items[k], k); }
    });
    await Promise.all(runners);
    return out;
  }

  const enc = encodeURIComponent;

  /** True when a user object carries a real given/family name (BBX.personName ignores preferredDisplayName). */
  const hasRealName = (u) => !!BBX.personName(u);
  const userNameCache = new Map(); // per sync run: userId -> user object (or null)
  const MAX_NAME_LOOKUPS = 6;      // per course; instructors lists are small

  /**
   * Instructor entries from courses/{id}/users often carry only userId (no name).
   * For each entry lacking user.name.given/family, GET /learn/api/public/v1/users/{userId}?fields=name
   * and attach the result as entry.user. Lookups that fail leave the entry unnamed
   * (rendered as "Instructor not yet synced"); nothing is invented.
   */
  async function fillInstructorNames(entries) {
    if (!Array.isArray(entries)) return entries;
    let lookups = 0;
    const out = [];
    for (const e of entries) {
      if (!e || typeof e !== 'object') { out.push(e); continue; }
      const role = String(e.courseRoleId || (e.courseRole && e.courseRole.identifier) || '');
      const user = e.user && typeof e.user === 'object' ? e.user : null;
      const userId = String(e.userId || (user && user.id) || '');
      if ((role && !/instructor|teaching|^ta$|^p$/i.test(role)) || hasRealName(user) || !userId) { out.push(e); continue; }
      if (!userNameCache.has(userId)) {
        if (lookups >= MAX_NAME_LOOKUPS) { out.push(e); continue; }
        lookups++;
        try {
          const u = await getJSON(`/learn/api/public/v1/users/${enc(userId)}?fields=name`);
          userNameCache.set(userId, u && typeof u === 'object' ? u : null);
        } catch (err) {
          log('instructor name lookup failed', userId, err.message);
          userNameCache.set(userId, null);
        }
      }
      const looked = userNameCache.get(userId);
      out.push(looked && hasRealName(looked) ? { ...e, user: { ...(user || {}), id: userId, name: looked.name } } : e);
    }
    return out;
  }

  // --------------------------------------------------------------- API sync
  async function syncViaApi() {
    userNameCache.clear();
    // 1) who am I — public API first, then the private API the Ultra UI uses.
    const meRes = await firstOk(['/learn/api/public/v1/users/me', '/learn/api/v1/users/me']);
    const me = meRes.data;
    const apiMode = meRes.path.includes('/public/') ? 'public' : 'private';
    if (!me || !me.id) throw new HttpError('bad-json', 200, 'users/me (no id)');
    const uid = enc(me.id);

    // 2) memberships (with course expanded)
    const memRes = await firstOk([
      `/learn/api/public/v1/users/${uid}/courses?expand=course&limit=100`,
      `/learn/api/v1/users/${uid}/memberships?expand=course&limit=100`,
    ], getAll);
    const memberships = Array.isArray(memRes.data) ? memRes.data : [];

    // 3) terms (names + dates) for grouping and "current" detection
    const termIds = [...new Set(memberships.map((m) => m && m.course && m.course.termId).filter(Boolean))];
    const terms = {};
    await pool(termIds, CONCURRENCY, async (tid) => {
      const r = await sectionFetch([`/learn/api/public/v1/terms/${enc(tid)}`, `/learn/api/v1/terms/${enc(tid)}`]);
      if (r.state === 'ok') terms[tid] = r.data;
    });

    // Decide which courses get detail fetches: current/upcoming terms, or (if term
    // data is unavailable) every course, capped. Purely to limit request volume.
    const pre = BBX.normalizeBlackboard({ me, memberships, terms });
    let detailIds = pre.courses.filter((c) => c.current === true && !c.locked).map((c) => c.id);
    if (!detailIds.length) detailIds = pre.courses.filter((c) => c.current !== false && !c.locked).map((c) => c.id);
    detailIds = detailIds.slice(0, MAX_DETAIL_COURSES);

    // 4) per-course detail sections (each independently fault-tolerant)
    const details = {};
    await pool(detailIds, CONCURRENCY, async (cid) => {
      const c = enc(cid);
      const [faculty, contents, columns, grades] = [
        await sectionFetch([
          `/learn/api/public/v1/courses/${c}/users?role=Instructor&expand=user&limit=50`,
          `/learn/api/public/v1/courses/${c}/users?role=Instructor&limit=50`, // names filled per user below
          `/learn/api/v1/courses/${c}/memberships?expand=user&role=Instructor&limit=50`,
        ], getAll),
        await sectionFetch([`/learn/api/public/v1/courses/${c}/contents?limit=200`], getAll),
        await sectionFetch([
          `/learn/api/public/v2/courses/${c}/gradebook/columns?limit=200`,
          `/learn/api/public/v1/courses/${c}/gradebook/columns?limit=200`,
        ], getAll),
        await sectionFetch([
          `/learn/api/public/v2/courses/${c}/gradebook/users/${uid}`,
          `/learn/api/public/v1/courses/${c}/gradebook/users/${uid}`,
        ], getAll),
      ];
      if (faculty.state === 'ok') faculty.data = await fillInstructorNames(faculty.data);
      details[cid] = { faculty, contents, columns, grades };
    });

    // 5) calendar items. Verified live: the call with NO params returns 200; the old
    //    since/until pair spanned 14 d back + ~16 weeks ahead (> the API's 16-week max
    //    window) and got 400. Fallback: one valid window (2 weeks back .. 14 weeks ahead
    //    = 16 weeks total) as full ISO-8601 UTC. Items are mapped per course in
    //    BBX.normalizeBlackboard (calendarId === course id, start === due, UTC).
    const since = new Date(Date.now() - 14 * 864e5);
    const until = new Date(since.getTime() + 16 * 7 * 864e5 - 60e3);
    const calendar = await sectionFetch([
      '/learn/api/public/v1/calendars/items',
      `/learn/api/public/v1/calendars/items?since=${enc(since.toISOString())}&until=${enc(until.toISOString())}`,
    ], getAll);

    const snapshot = BBX.normalizeBlackboard({ me, memberships, terms, details, calendar, apiMode });
    const counts = {
      courses: snapshot.courses.length,
      detailed: detailIds.length,
      calendar: calendar.state,
      sectionsFailed: Object.values(details).reduce((n, d) => n + Object.values(d).filter((s) => s.state !== 'ok').length, 0),
    };
    return { snapshot, counts, apiMode };
  }

  // -------------------------------------------------------- DOM fallback
  /** Scrape the Ultra course list (only when the API is unusable). Heuristic selectors. */
  function scrapeUltraCourseList() {
    const cards = [];
    const nodes = document.querySelectorAll('[id^="course-list-course-"], [data-course-id], article.course-element-card, .course-element-card');
    const seen = new Set();
    for (const el of nodes) {
      try {
        let id = el.getAttribute('data-course-id') || '';
        if (!id) { const m = (el.id || '').match(/course-list-course-(_\d+_\d+)/); if (m) id = m[1]; }
        if (!id || seen.has(id)) continue;
        const q = (sel) => { const n = el.querySelector(sel); return n ? n.textContent : ''; };
        const title = q('.js-course-title-element, h4.course-title, [class*="course-title"], h4, h3');
        if (!title || !title.trim()) continue;
        seen.add(id);
        const text = (el.textContent || '').toLowerCase();
        cards.push({
          id,
          title,
          bbId: (q('.course-id, [class*="course-id"]') || '').trim() || null,
          instructor: q('.instructors, [class*="instructor"]') || null,
          // Only mark closed when the card explicitly says so; otherwise unknown.
          closed: /\b(private|closed|unavailable|not open)\b/.test(text) ? true : null,
        });
      } catch (e) { log('card scrape failed', e); }
    }
    return cards;
  }

  function looksLikeLoginPage() {
    return /^\/webapps\/login/i.test(location.pathname) || /\/auth-saml\//i.test(location.pathname) ||
      !!document.querySelector('form#login-form, form[name="login"], input[type="password"]');
  }

  // ------------------------------------------------------------- main sync
  async function runSync({ force = false, reason = 'auto' } = {}) {
    if (syncing) return { ok: false, reason: 'already-syncing' };
    syncing = true;
    try {
      if (looksLikeLoginPage()) {
        await reportStatus('session-expired', { message: 'Blackboard login page detected.' });
        return { ok: false, reason: 'session-expired' };
      }
      if (!force) {
        const st = await send({ type: 'bbx:getStatus' });
        const last = st && st.blackboard && st.blackboard.lastSuccessAt ? Date.parse(st.blackboard.lastSuccessAt) : 0;
        if (Date.now() - last < MIN_INTERVAL_MS) return { ok: true, reason: 'fresh-enough' };
      }
      await reportStatus('syncing', { reason });
      try {
        const { snapshot, counts, apiMode } = await syncViaApi();
        const resp = await send({ type: 'bbx:storeBlackboard', snapshot });
        await reportStatus(resp && resp.ok ? 'ok' : 'store-failed', { source: BBX.SOURCES.API, apiMode, counts, lastSuccessAt: resp && resp.ok ? new Date().toISOString() : undefined });
        return { ok: !!(resp && resp.ok), counts };
      } catch (e) {
        log('API sync failed', e);
        if (e && e.kind === 'auth') {
          await reportStatus('session-expired', { message: 'Blackboard API returned 401 / login redirect. Cached data kept.' });
          return { ok: false, reason: 'session-expired' };
        }
        // API unusable for a non-auth reason -> DOM fallback on the course list page.
        const cards = scrapeUltraCourseList();
        if (cards.length) {
          const nameEl = document.querySelector('.base-navigation-profile-name, [class*="profile-name"], #profile-name');
          const snapshot = BBX.normalizeDomCourses(cards, nameEl ? nameEl.textContent : '');
          const resp = await send({ type: 'bbx:storeBlackboard', snapshot });
          await reportStatus('partial', { source: BBX.SOURCES.DOM, message: `API failed (${e.message}); scraped ${cards.length} course card(s) from the page.`, lastSuccessAt: resp && resp.ok ? new Date().toISOString() : undefined });
          return { ok: true, reason: 'dom-fallback' };
        }
        await reportStatus('error', { message: `API failed (${e && e.message ? e.message : e}). Open the Courses page for the DOM fallback. Cached data kept.` });
        return { ok: false, reason: 'error' };
      }
    } catch (e) {
      log('sync crashed', e);
      await reportStatus('error', { message: String(e && e.message ? e.message : e) });
      return { ok: false, reason: 'error' };
    } finally {
      syncing = false;
    }
  }

  // Background / dashboard can ask an open Blackboard tab to sync now.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'bbx:sync') return false;
    runSync({ force: !!msg.force, reason: msg.reason || 'requested' }).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // async response
  });

  // Auto-sync shortly after page load (lets Ultra finish its own boot first).
  setTimeout(() => { runSync({ reason: 'page-load' }); }, 2500);
})();
