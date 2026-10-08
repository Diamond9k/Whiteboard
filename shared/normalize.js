/*
 * shared/normalize.js — data-normalization module shared by every part of the
 * extension (content scripts, background service worker, dashboard, popup, tests).
 *
 * Loaded as a CLASSIC script (no import/export) so it works in all contexts:
 *   - content scripts:  listed before blackboard.js / pearson.js in manifest.json
 *   - service worker:   importScripts('shared/normalize.js')
 *   - extension pages:  <script src="shared/normalize.js"></script>
 *   - node tests:       require('../shared/normalize.js')
 * It exposes a single global: globalThis.BBX.
 *
 * NO-HALLUCINATION CONTRACT
 *   Every function here only reshapes values that were actually pulled. Missing
 *   input => the field is omitted (or the section is marked state != 'ok'),
 *   which the dashboard renders as "Not yet synced". Nothing is guessed,
 *   defaulted to a plausible value, or filled from sample data.
 *   The only derived values are mechanical: course code parsed from the real
 *   Blackboard courseId, display strings built from real score/possible
 *   numbers, a presentational colour hashed from the course id, and a due-date
 *   status computed from a real due date + the real grade record.
 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const BB_ORIGIN = 'https://learn.uark.edu';
  const STORAGE_KEYS = Object.freeze({
    blackboard: 'bbx_blackboard', // normalized Blackboard snapshot (single writer: background)
    pearson: 'bbx_pearson',       // { records: { [key]: pearsonRecord } }
    status: 'bbx_status',         // { blackboard: {...}, pearson: {...} }
    prefs: 'bbx_prefs',           // UI prefs only (layout, favourites, Pearson->course mapping)
  });
  const SOURCES = Object.freeze({ API: 'blackboard-api', DOM: 'blackboard-dom', PEARSON: 'pearson' });

  // ------------------------------------------------------------------ utils
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const nonEmpty = (v) => str(v).length > 0;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const nowIso = () => new Date().toISOString();
  const validIso = (v) => (nonEmpty(v) && !isNaN(new Date(v)) ? new Date(v).toISOString() : null);

  /** Round to at most 2 decimals without inventing precision. */
  function num(n) {
    if (!finite(n)) return null;
    return Math.round(n * 100) / 100;
  }

  /** Strip HTML to plain text (Blackboard descriptions are HTML). No DOM needed. */
  function stripHtml(html, max = 280) {
    if (typeof html !== 'string') return '';
    let t = html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > max) t = t.slice(0, max - 1).trimEnd() + '…';
    return t;
  }

  /** Collapse whitespace in scraped DOM text. */
  const cleanText = (t, max = 300) => {
    const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  /** Only allow https links to Blackboard / Pearson to be rendered as hrefs. */
  function safeUrl(u) {
    try {
      const url = new URL(u);
      if (url.protocol !== 'https:') return null;
      if (url.origin === BB_ORIGIN) return url.href;
      if (url.hostname === 'pearson.com' || url.hostname.endsWith('.pearson.com')) return url.href;
      return null;
    } catch (_) { return null; }
  }

  /** Presentational colour from a stable hash of the course id (UI chrome, not data). */
  const PALETTE = ['#7b2d8e', '#2d6a8e', '#2e8b57', '#9e6b2d', '#8e2d4f', '#3d5a9e', '#5a7d2d', '#8e5a2d'];
  function colorFor(id) {
    const s = String(id || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /**
   * Parse a UARK-style courseId, YEAR_TERM_SUBJ_NUMBER_SECnnn -> "SUBJ NUMBER-nnn".
   * Returns null if the id doesn't follow that pattern (caller then shows the raw id).
   */
  function courseCodeFromId(courseId) {
    const m = str(courseId).match(/^\d{4}_[A-Z]+_([A-Z]{2,5})_(\d{4,5})_SEC(\w+)$/i);
    return m ? `${m[1].toUpperCase()} ${m[2]}-${m[3].toUpperCase()}` : null;
  }

  /** Map a Blackboard contentHandler id to the mirror's content type. */
  function contentType(handlerId) {
    const h = str(handlerId);
    if (/x-bb-folder/.test(h)) return 'folder';
    if (/x-bb-lesson|x-bb-module|learning-module/.test(h)) return 'module';
    if (/externallink|blti-link|lti/.test(h)) return 'link';
    if (/document|x-bb-file|x-bb-syllabus|x-bb-asmt|assignment|test|forumlink/.test(h)) return 'document';
    return 'generic';
  }

  /** Section envelope: { state, source, syncedAt, data?, error? }. */
  function section(state, source, data, error) {
    const s = { state, source, syncedAt: nowIso() };
    if (data !== undefined) s.data = data;
    if (error) s.error = String(error).slice(0, 200);
    return s;
  }

  // ------------------------------------------------------- Blackboard (API)

  /**
   * Strings Blackboard puts INSIDE the name object as display-setting enums
   * (e.g. name.preferredDisplayName === "GivenName"). They are never real names.
   */
  const NAME_PLACEHOLDER = /^(given\s*name|family\s*name|preferred\s*name|middle\s*name)$/i;
  const NAME_PLACEHOLDER_IN_TEXT = /\b(GivenName|FamilyName|PreferredName|MiddleName)\b/;
  const namePart = (v) => { const s = str(v); return s && !NAME_PLACEHOLDER.test(s) ? s : ''; };

  /** True when a stored display name was built from a placeholder enum (old cache). */
  const isPlaceholderName = (name) => !nonEmpty(name) || NAME_PLACEHOLDER_IN_TEXT.test(str(name));

  /**
   * Display name from a Blackboard user payload: name.given + ' ' + name.family
   * (public API), or givenName/familyName (private API). name.preferredDisplayName
   * is a display-SETTING enum ("GivenName"), NOT a name, and is never read.
   * Returns null when no real name is present (rendered as "not yet synced").
   */
  function personName(u) {
    if (!isObj(u)) return null;
    const n = isObj(u.name) ? u.name : {};
    const given = namePart(n.given) || namePart(u.givenName);
    const family = namePart(n.family) || namePart(u.familyName);
    const name = [given, family].filter(Boolean).join(' ');
    return name || null;
  }

  /** Student display name from a users/me payload (public or private API). */
  function studentFromMe(me) {
    if (!isObj(me)) return null;
    const name = personName(me);
    if (!name) return null;
    return { name, id: str(me.id) || undefined, verified: true };
  }

  /** Availability -> "Open"/"Closed"/null (null = unknown, rendered as not synced). */
  function courseStatus(course) {
    if (!isObj(course)) return null;
    const a = isObj(course.availability) ? str(course.availability.available) : '';
    if (/^yes$/i.test(a)) return 'Open';
    if (/^(no|disabled)$/i.test(a)) return 'Closed';
    if (/^term$/i.test(a)) return 'Term';       // depends on term availability
    if (course.isAvailable === true) return 'Open';
    if (course.isAvailable === false) return 'Closed';
    return null;
  }

  /** One membership row (public v1 users/{id}/courses?expand=course OR private memberships). */
  function courseFromMembership(m, termsById) {
    if (!isObj(m)) return null;
    const c = isObj(m.course) ? m.course : null;
    const id = str(c && c.id) || str(m.courseId);
    if (!id) return null;
    if (c && (c.organization === true || c.isOrganization === true)) return null; // orgs aren't courses
    const role = str(m.courseRoleId);
    const bbId = str(c && c.courseId) || '';
    const title = str(c && (c.name || c.displayName)) || '';
    const termId = str(c && c.termId);
    const term = termId && termsById && termsById[termId] ? termsById[termId] : null;
    let status = courseStatus(c);
    if (status === 'Term') status = term && term.available === true ? 'Open' : term && term.available === false ? 'Closed' : null;
    const out = {
      id,
      verified: !!(bbId || title),
      code: courseCodeFromId(bbId) || bbId || null,
      bbId: bbId || null,
      title: title || null,
      status,
      role: role || null,
      termId: termId || null,
      termName: term ? term.name : null,
      color: colorFor(id),
      home: `${BB_ORIGIN}/ultra/courses/${encodeURIComponent(id)}/outline`,
    };
    if (status === 'Closed') {
      out.locked = true;
      out.note = 'Blackboard reports this course as unavailable. When your instructor opens it, it will sync here.';
    }
    return out;
  }

  /** Term payload -> { id, name, start, end, available }. */
  function normalizeTerm(t) {
    if (!isObj(t) || !nonEmpty(t.id)) return null;
    const av = isObj(t.availability) ? t.availability : {};
    const dur = isObj(av.duration) ? av.duration : {};
    return {
      id: str(t.id),
      name: str(t.name) || null,
      start: validIso(dur.start),
      end: validIso(dur.end),
      available: /^yes$/i.test(str(av.available)) ? true : /^no$/i.test(str(av.available)) ? false : null,
    };
  }

  /** Is this term current/upcoming (or recently ended)? null = unknown. */
  function termIsCurrent(term, now = Date.now(), graceDays = 21) {
    if (!term) return null;
    const s = term.start ? Date.parse(term.start) : NaN;
    const e = term.end ? Date.parse(term.end) : NaN;
    if (isNaN(s) && isNaN(e)) return null;
    if (!isNaN(e) && e + graceDays * 864e5 < now) return false;
    return true; // in progress, upcoming, or open-ended
  }

  /**
   * Instructors from courses/{id}/users?role=Instructor&expand=user (public) or the
   * private equivalent. Names come ONLY from entry.user.name.given/family (the
   * content script fills entry.user from GET users/{userId}?fields=name when
   * expand=user didn't include a name). Entries with no obtainable name are
   * counted, never invented: facultyInfo(...).unnamed.
   */
  function facultyInfo(results) {
    const named = [];
    let unnamed = 0;
    const seen = new Set();
    if (!Array.isArray(results)) return { named, unnamed };
    for (const r of results) {
      if (!isObj(r)) continue;
      const role = str(r.courseRoleId) || str(isObj(r.courseRole) && r.courseRole.identifier);
      if (role && !/instructor|teaching|^ta$|^p$/i.test(role)) continue;
      const u = isObj(r.user) ? r.user : null;
      const uid = str(r.userId) || str(u && u.id);
      if (uid && seen.has(uid)) continue;
      if (uid) seen.add(uid);
      const name = personName(u);
      if (!name) { unnamed++; continue; }
      named.push({ name, role: /assistant|^ta$/i.test(role) ? 'TEACHING ASSISTANT' : 'INSTRUCTOR', verified: true, source: SOURCES.API });
    }
    return { named, unnamed };
  }
  const facultyFrom = (results) => facultyInfo(results).named;

  /** Top-level content items from courses/{id}/contents. */
  function contentFrom(results) {
    if (!Array.isArray(results)) return [];
    const out = [];
    for (const r of results) {
      if (!isObj(r) || !nonEmpty(r.title)) continue;
      const handler = isObj(r.contentHandler) ? str(r.contentHandler.id) : '';
      const item = { type: contentType(handler), title: str(r.title), verified: true, source: SOURCES.API };
      const d = stripHtml(r.description || r.body || '');
      if (d) item.desc = d;
      if (nonEmpty(r.id)) item.id = str(r.id);
      // Progress is NOT exposed by the public contents endpoint -> omitted (renders as "progress not yet synced").
      out.push(item);
    }
    return out;
  }

  /** Display string for one grade record, built only from real numbers/text. */
  function gradeText(grade, possible) {
    if (!isObj(grade)) return null;
    const dg = isObj(grade.displayGrade) ? grade.displayGrade : null;
    if (dg) {
      if (nonEmpty(dg.text)) {
        const t = str(dg.text);
        if (/^\d+(\.\d+)?$/.test(t) && finite(possible) && possible > 0) return `${t} / ${num(possible)}`;
        return t;
      }
      if (finite(dg.score)) {
        if (/percent/i.test(str(dg.scaleType))) return `${num(dg.score)}%`;
        if (finite(possible) && possible > 0) return `${num(dg.score)} / ${num(possible)}`;
        return String(num(dg.score));
      }
    }
    if (nonEmpty(grade.text)) return str(grade.text);
    if (finite(grade.score)) {
      return finite(possible) && possible > 0 ? `${num(grade.score)} / ${num(possible)}` : String(num(grade.score));
    }
    return null;
  }

  /** Column display name (v2 uses `name`, some payloads use `columnName`). */
  const colName = (c) => (isObj(c) ? str(c.name) || str(c.columnName) : '');
  const isCalculated = (c) => isObj(c) && isObj(c.grading) && /^calculated$/i.test(str(c.grading.type));

  /**
   * Pick the OVERALL grade column from gradebook/columns. Signals (all real API fields):
   *   externalGrade === true (Blackboard's primary/"external" grade column)  +4
   *   name/columnName contains "Overall"                                      +3
   *   grading.type === "Calculated"                                           +2
   *   name/columnName contains "Total"                                        +1
   * Highest score wins. A tie at the top (without externalGrade) is ambiguous
   * => no overall column (rendered "not yet synced"); we never sum items ourselves.
   */
  function findOverallColumn(cols) {
    let best = null, bestScore = 0, tie = false;
    for (const c of Array.isArray(cols) ? cols : []) {
      if (!isObj(c) || !nonEmpty(c.id)) continue;
      const name = colName(c);
      let sc = 0;
      if (c.externalGrade === true) sc += 4;
      if (/overall/i.test(name)) sc += 3;
      if (isCalculated(c)) sc += 2;
      if (/\btotal\b/i.test(name)) sc += 1;
      if (sc === 0) continue;
      if (sc > bestScore) { best = c; bestScore = sc; tie = false; }
      else if (sc === bestScore) tie = true;
    }
    if (best && tie && best.externalGrade !== true) return { column: null, ambiguous: true };
    return { column: best, ambiguous: false };
  }

  /**
   * Gradebook from columns (v2/v1 gradebook/columns) + this user's grades
   * (gradebook/users/{userId}). Overall grade = findOverallColumn(); its value is
   * the grade entry whose columnId === that column's id (displayGrade.score/text or score).
   * Both arrays empty => grades live outside Blackboard (e.g. Pearson): gb.empty.
   */
  function gradebookFrom(columns, grades) {
    const cols = Array.isArray(columns) ? columns.filter(isObj) : [];
    const gs = Array.isArray(grades) ? grades.filter(isObj) : [];
    const gradeByCol = {};
    for (const g of gs) if (nonEmpty(g.columnId)) gradeByCol[g.columnId] = g;

    const gb = { verified: true, source: SOURCES.API, syncedAt: nowIso(), items: [] };
    const { column: overall, ambiguous } = findOverallColumn(cols);
    if (overall) {
      const possible = isObj(overall.score) ? overall.score.possible : undefined;
      const t = gradeText(gradeByCol[overall.id], possible);
      if (t) gb.currentGrade = t;
      gb.overallColumn = colName(overall) || null;
      gb.overallColumnId = str(overall.id);
    } else if (cols.length) {
      gb.noOverallColumn = true;
      if (ambiguous) gb.overallAmbiguous = true;
    }
    for (const c of cols) {
      if (c === overall || !nonEmpty(colName(c))) continue;
      const possible = isObj(c.score) ? c.score.possible : undefined;
      const g = gradeByCol[c.id];
      const item = { title: colName(c), verified: true, source: SOURCES.API };
      const t = gradeText(g, possible);
      if (t) item.grade = t;
      else if (finite(possible)) item.possible = num(possible);
      if (g && nonEmpty(g.status)) item.status = str(g.status);
      const due = isObj(c.grading) ? validIso(c.grading.due) : null;
      if (due) item.due = due;
      if (nonEmpty(c.id)) item.columnId = str(c.id);
      gb.items.push(item);
    }
    // Individual grades count as synced when the per-user grade call actually returned (even if empty).
    gb.itemsSynced = Array.isArray(grades);
    // Nothing at all in Blackboard's gradebook (Pearson-backed courses): "No grades posted in Blackboard".
    if (!cols.length && !gs.length) gb.empty = true;
    return gb;
  }

  /**
   * Due-date status from REAL data only:
   *   submitted - grade record exists with a score or NeedsGrading status
   *   due       - due date is in the future
   *   overdue   - due date passed AND a grade record was fetched showing no score/attempt
   *   past      - due date passed, but no grade record available to say either way
   */
  function dueStatus(dueIso, gradeRecord, now = Date.now()) {
    const t = Date.parse(dueIso);
    if (isNaN(t)) return null;
    if (gradeRecord && (finite(gradeRecord.score) || /graded|needsgrading/i.test(str(gradeRecord.status)) ||
        (isObj(gradeRecord.displayGrade) && (finite(gradeRecord.displayGrade.score) || nonEmpty(gradeRecord.displayGrade.text))))) return 'submitted';
    if (t >= now) return 'due';
    return gradeRecord ? 'overdue' : 'past';
  }

  /**
   * Upcoming items for one course: gradebook columns that have a real due date,
   * plus calendar items for that course. For calendars/items, `start` IS the due
   * datetime (UTC); items without a valid `start` are skipped. A calendar item of
   * type GradebookColumn whose id equals a fetched column id is linked to that
   * column's grade record (exact id match only) and deduped against it.
   */
  function upcomingFrom(columns, grades, calendarItems, now = Date.now()) {
    const out = [];
    const seen = new Set();
    const seenCol = new Set();
    const gradeByCol = {};
    const colById = {};
    for (const g of Array.isArray(grades) ? grades : []) if (isObj(g) && nonEmpty(g.columnId)) gradeByCol[g.columnId] = g;
    for (const c of Array.isArray(columns) ? columns : []) if (isObj(c) && nonEmpty(c.id)) colById[c.id] = c;
    const gradesFetched = Array.isArray(grades);
    const overallId = (findOverallColumn(columns).column || {}).id;
    for (const c of Array.isArray(columns) ? columns : []) {
      if (!isObj(c) || !nonEmpty(colName(c)) || c.externalGrade === true || (overallId && c.id === overallId)) continue;
      const due = isObj(c.grading) ? validIso(c.grading.due) : null;
      if (!due) continue;
      const rec = gradesFetched ? (gradeByCol[c.id] || {}) : null;
      out.push({ title: colName(c), due, status: dueStatus(due, rec, now), verified: true, source: SOURCES.API, origin: 'gradebook' });
      seen.add(colName(c).toLowerCase() + '|' + due);
      if (nonEmpty(c.id)) seenCol.add(str(c.id));
    }
    for (const it of Array.isArray(calendarItems) ? calendarItems : []) {
      if (!isObj(it) || !nonEmpty(it.title)) continue;
      const due = validIso(it.start);
      if (!due) continue;
      const id = str(it.id);
      const linkedCol = /gradebookcolumn/i.test(str(it.type)) && id && colById[id] ? colById[id] : null;
      if (linkedCol && seenCol.has(id)) continue;
      const key = str(it.title).toLowerCase() + '|' + due;
      if (seen.has(key)) continue;
      seen.add(key);
      const rec = linkedCol && gradesFetched ? (gradeByCol[id] || {}) : null;
      const u = { title: str(it.title), due, status: dueStatus(due, rec, now), verified: true, source: SOURCES.API, origin: 'calendar' };
      const props = isObj(it.dynamicCalendarItemProps) ? it.dynamicCalendarItemProps : null;
      if (props && nonEmpty(props.eventType)) u.eventType = cleanText(props.eventType, 60);
      if (nonEmpty(it.type)) u.calendarType = str(it.type);
      out.push(u);
    }
    return out.sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  }

  /** Group calendar items by course id (calendarId is the course's primary key). */
  function calendarByCourse(items) {
    const map = {};
    for (const it of Array.isArray(items) ? items : []) {
      if (!isObj(it)) continue;
      const cid = str(it.calendarId) || str(it.courseId);
      if (!cid) continue;
      (map[cid] = map[cid] || []).push(it);
    }
    return map;
  }

  /**
   * Build the normalized Blackboard snapshot from raw API pieces.
   * raw = {
   *   me, memberships: [], terms: {id: termPayload}, calendar: {state, data:[]},
   *   details: { [courseId]: { faculty:{state,data}, contents:{state,data}, columns:{state,data}, grades:{state,data} } }
   * }
   * Every section keeps its own state so the dashboard can say exactly what is
   * and isn't synced, per course.
   */
  function normalizeBlackboard(raw, now = Date.now()) {
    const syncedAt = nowIso();
    const termsById = {};
    for (const [id, t] of Object.entries(isObj(raw && raw.terms) ? raw.terms : {})) {
      const nt = normalizeTerm(t);
      if (nt) termsById[id] = nt;
    }
    const cal = isObj(raw && raw.calendar) ? raw.calendar : { state: 'not-fetched' };
    const calMap = cal.state === 'ok' ? calendarByCourse(cal.data) : {};
    const courses = [];
    for (const m of Array.isArray(raw && raw.memberships) ? raw.memberships : []) {
      const c = courseFromMembership(m, termsById);
      if (!c) continue;
      if (c.role && !/student|^s$/i.test(c.role)) c.nonStudentRole = true;
      const term = c.termId ? termsById[c.termId] : null;
      c.current = termIsCurrent(term, now);
      c.source = SOURCES.API;
      c.syncedAt = syncedAt;

      const d = isObj(raw.details) && isObj(raw.details[c.id]) ? raw.details[c.id] : null;
      c.sections = {};
      if (!d) {
        c.sections.details = { state: 'not-fetched', source: SOURCES.API, syncedAt };
        // No per-course detail fetch, but the calendar call may still have real due dates for it.
        if (cal.state === 'ok' && Array.isArray(calMap[c.id]) && calMap[c.id].length) {
          c.upcoming = upcomingFrom([], undefined, calMap[c.id], now);
          c.sections.upcoming = { state: 'ok', source: SOURCES.API, syncedAt };
        }
      } else {
        const fac = d.faculty || {}, con = d.contents || {}, col = d.columns || {}, gr = d.grades || {};
        c.sections.faculty = { state: fac.state || 'not-fetched', source: SOURCES.API, syncedAt: fac.syncedAt || syncedAt, error: fac.error };
        c.sections.content = { state: con.state || 'not-fetched', source: SOURCES.API, syncedAt: con.syncedAt || syncedAt, error: con.error };
        c.sections.gradebook = { state: col.state === 'ok' ? (gr.state === 'ok' ? 'ok' : 'partial') : (col.state || 'not-fetched'), source: SOURCES.API, syncedAt, error: col.error || gr.error };
        if (fac.state === 'ok') {
          const fi = facultyInfo(fac.data);
          c.faculty = fi.named;
          if (fi.unnamed) c.facultyUnnamed = fi.unnamed; // listed by Blackboard, but no name returned
        }
        if (con.state === 'ok') c.content = contentFrom(con.data);
        if (col.state === 'ok') c.gradebook = gradebookFrom(col.data, gr.state === 'ok' ? gr.data : null);
        if (col.state === 'ok' || cal.state === 'ok') {
          c.upcoming = upcomingFrom(col.state === 'ok' ? col.data : [], gr.state === 'ok' ? gr.data : undefined, calMap[c.id], now);
          c.sections.upcoming = { state: 'ok', source: SOURCES.API, syncedAt };
        } else {
          c.sections.upcoming = { state: 'not-fetched', source: SOURCES.API, syncedAt };
        }
      }
      courses.push(c);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      _meta: { source: SOURCES.API, pulled_at: syncedAt, apiMode: (raw && raw.apiMode) || null },
      student: studentFromMe(raw && raw.me),
      terms: termsById,
      courses,
    };
  }

  /**
   * Normalized snapshot from Ultra DOM course cards (fallback when the API fails).
   * cards = [{ id, bbId, title, instructor, closed }] — only what was found.
   */
  function normalizeDomCourses(cards, studentName) {
    const syncedAt = nowIso();
    const courses = [];
    for (const k of Array.isArray(cards) ? cards : []) {
      if (!isObj(k)) continue;
      const id = str(k.id);
      const title = cleanText(k.title);
      if (!id || !title) continue;
      const bbId = str(k.bbId) || null;
      const c = {
        id, bbId, title, verified: true,
        code: courseCodeFromId(bbId) || bbId,
        status: k.closed === true ? 'Closed' : k.closed === false ? 'Open' : null,
        color: colorFor(id),
        home: `${BB_ORIGIN}/ultra/courses/${encodeURIComponent(id)}/outline`,
        source: SOURCES.DOM, syncedAt, current: null,
        termName: cleanText(k.termName) || null,
        sections: { details: { state: 'not-fetched', source: SOURCES.DOM, syncedAt } },
      };
      if (nonEmpty(k.instructor)) c.faculty = [{ name: cleanText(k.instructor, 120), role: 'INSTRUCTOR', verified: true, source: SOURCES.DOM }];
      if (c.status === 'Closed') { c.locked = true; c.note = 'Blackboard shows this course as unavailable.'; }
      courses.push(c);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      _meta: { source: SOURCES.DOM, pulled_at: syncedAt },
      student: nonEmpty(studentName) ? { name: cleanText(studentName, 80), verified: true } : null,
      terms: {},
      courses,
    };
  }

  /**
   * Merge a fresh snapshot over the cached one WITHOUT losing good data:
   *  - courses present in `next` replace their cached copy, except any section
   *    whose fetch failed this time keeps the previous good value (marked stale).
   *  - a DOM snapshot never overwrites richer API data for the same course;
   *    it only adds courses the API never returned.
   *  - if `next` has zero courses, the cached courses are kept.
   */
  function mergeBlackboard(prev, next) {
    if (!isObj(next)) return prev || null;
    if (!isObj(prev) || !Array.isArray(prev.courses)) return next;
    const prevById = {};
    for (const c of prev.courses) if (isObj(c)) prevById[c.id] = c;

    if (next._meta && next._meta.source === SOURCES.DOM) {
      const merged = prev.courses.slice();
      for (const c of next.courses || []) if (!prevById[c.id]) merged.push(c);
      return { ...prev, courses: merged, student: prev.student || next.student, _meta: { ...prev._meta, lastDomScrape: next._meta.pulled_at } };
    }
    if (!Array.isArray(next.courses) || !next.courses.length) {
      return { ...prev, _meta: { ...prev._meta, lastEmptyPull: next._meta && next._meta.pulled_at } };
    }
    const FIELDS = { faculty: ['faculty', 'facultyUnnamed'], content: ['content'], gradebook: ['gradebook'], upcoming: ['upcoming'] };
    const courses = next.courses.map((c) => {
      const old = prevById[c.id];
      if (!old) return c;
      const out = { ...c, sections: { ...(c.sections || {}) } };
      for (const [sec, fields] of Object.entries(FIELDS)) {
        const st = out.sections[sec];
        const ok = st && (st.state === 'ok' || st.state === 'partial');
        if (!ok && old.sections && old.sections[sec] && (old.sections[sec].state === 'ok' || old.sections[sec].state === 'partial')) {
          for (const f of fields) if (old[f] !== undefined) out[f] = old[f];
          out.sections[sec] = { ...old.sections[sec], stale: true, lastError: st ? st.error || st.state : 'not-fetched' };
        }
      }
      return out;
    });
    return { ...next, courses, student: next.student || prev.student, terms: { ...(prev.terms || {}), ...(next.terms || {}) } };
  }

  // ----------------------------------------------------------------- Pearson
  //
  // Real structure of mylab.pearson.com/Student/Results.aspx (captured from a live session):
  //   Overall:     #overallScore .score-value            -> a percent number
  //                #overall-score-details p              -> "You have earned X out of Y points for a Overall Score of Z%."
  //   Categories:  #ctl00_ctl00_InsideForm_MasterContent_OverallScoreGrid (.table-overall-score)
  //                tbody tr: th[scope=row] = category; td = Average Score | Category Weight | Points Earned | Time Spent
  //                tfoot tr = Total
  //   Assignments: table.table-inner-bordered, tbody tr[id^=row]
  //                thead th (verified live, in order): Assignment | Review | Correct/Total | Score |
  //                  Time Spent | Date Started | Date Worked  -> cells are mapped BY HEADER LABEL
  //                th.leftcol = name (+ <i> icon + hidden span.readableButHidden category label)
  //                Correct/Total "a/b", optionally followed by "*" (+ possible footnote <sup>; blank on incomplete
  //                rows); Score "NN.NN%" (+ "(omitted)" line on omitted rows). "incomplete" may be
  //                in the Score cell OR another cell (live MATH page: around Time Spent) => any cell;
  //                dates are MM/DD/YY + line break + a time; tr.omit = omitted
  // Every value is stored as the page's own text (whitespace-collapsed) after a
  // format check; a cell that fails its check is left out, never guessed.

  const PEARSON_SEL = Object.freeze({
    overallValue: '#overallScore .score-value',
    overallDetails: '#overall-score-details p',
    categoryTable: '#ctl00_ctl00_InsideForm_MasterContent_OverallScoreGrid, table.table-overall-score',
    itemTable: 'table.table-inner-bordered',
  });
  const RE_PCT = /^(\d{1,3}(?:\.\d+)?)\s*%$/;              // "NN.NN %" or "NN.NN%"
  const RE_PTS = /^(\d+(?:\.\d+)?)\s*(?:pts?|points?)$/i;   // "40 pts" / "24.31 pts"
  const RE_FRACTION = /^(\d+)\s*\/\s*(\d+)$/;              // "a/b"

  /** "You have earned X out of Y points for a Overall Score of Z%." -> parts found. */
  function parsePearsonOverallDetails(text) {
    const t = cleanText(text, 2000);
    const out = {};
    const pts = t.match(/earned\s+(\d+(?:\.\d+)?)\s+out\s+of\s+(\d+(?:\.\d+)?)\s+points?/i);
    if (pts) { out.earned = pts[1]; out.total = pts[2]; }
    const pct = t.match(/overall\s+score\s+of\s+(\d{1,3}(?:\.\d+)?)\s*%/i);
    if (pct) out.percent = pct[1];
    return Object.keys(out).length ? out : null;
  }

  /** Text of a node with icons / screen-reader-only labels removed (no DOM mutation of the page). */
  function cellText(node, dropSel = 'i, svg, img, .readableButHidden') {
    if (!node) return '';
    try {
      const c = node.cloneNode(true);
      if (dropSel) for (const x of c.querySelectorAll(dropSel)) x.remove();
      return cleanText(c.textContent, 300);
    } catch (_) { return cleanText(node.textContent, 300); }
  }

  /** Recursive text where every element boundary / <br> becomes a space (works without layout, e.g. jsdom). */
  function joinedNodeText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue || '';              // text
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';        // comments etc.
    if (String(node.tagName).toUpperCase() === 'BR') return ' ';
    return Array.from(node.childNodes || []).map(joinedNodeText).join(' ');
  }

  /**
   * Cell text for multi-line cells (e.g. Date Started = MM/DD/YY + line break + a time):
   * a single space between visual lines, whitespace collapsed. In a real browser the cell's
   * own innerText is used when available and the cell has nothing to drop (icons / hidden
   * labels); otherwise the child nodes of a clone (drop-selector removed) are joined with spaces.
   */
  function spacedCellText(node, dropSel = 'i, svg, img, .readableButHidden') {
    if (!node) return '';
    try {
      const hasDrop = dropSel && node.querySelector && node.querySelector(dropSel);
      if (!hasDrop && typeof node.innerText === 'string' && node.innerText.trim()) return cleanText(node.innerText, 300);
      const c = node.cloneNode(true);
      if (dropSel) for (const x of c.querySelectorAll(dropSel)) x.remove();
      return cleanText(joinedNodeText(c), 300);
    } catch (_) { return cleanText(node.textContent, 300); }
  }

  /** A date glued to its time -> date + space + time (belt-and-braces if the line break was lost). */
  function fixDateTime(s) {
    let t = cleanText(s, 80);
    // 2-digit year directly followed by a time
    t = t.replace(/^(\d{2}\/\d{2}\/\d{2})(\d{1,2}:\d{2})/, '$1 $2');
    return t;
  }

  const tdsOf = (tr) => Array.from(tr.children).filter((n) => String(n.tagName).toUpperCase() === 'TD');
  const cellsOf = (tr) => Array.from(tr.children).filter((n) => /^(TD|TH)$/.test(String(n.tagName).toUpperCase()));
  const ifMatch = (text, re) => (re.test(text) ? text : undefined);
  const spanOf = (cell) => { const n = parseInt(cell && cell.getAttribute && cell.getAttribute('colspan'), 10); return n > 0 && n < 50 ? n : 1; };

  /** Cells of a row keyed by their starting column position (colspan-aware). */
  function cellsByPosition(tr) {
    const out = {};
    let pos = 0;
    for (const c of cellsOf(tr)) { out[pos] = c; pos += spanOf(c); }
    return out;
  }

  function parseCategoryRow(tr) {
    const th = tr.querySelector('th[scope="row"], th[scope=row]') || tr.querySelector('th');
    const name = cellText(th);
    const td = tdsOf(tr).map((x) => cellText(x, 'i, svg, img'));
    const row = { name };
    const avg = ifMatch(td[0] || '', RE_PCT); if (avg) row.average = avg;
    const weight = ifMatch(td[1] || '', RE_PTS); if (weight) row.weight = weight;
    const earned = ifMatch(td[2] || '', RE_PTS); if (earned) row.earned = earned;
    if (nonEmpty(td[3])) row.timeSpent = td[3];
    return row;
  }

  // ---- Assignment table: columns are mapped BY HEADER LABEL (live order:
  // Assignment | Review | Correct/Total | Score | Time Spent | Date Started | Date Worked).
  // Rules are tried in order; a header cell is claimed by the first rule it matches.
  const ITEM_HEADER_RULES = [
    ['correctTotal', (l) => l.includes('correct/total') || l.includes('correct')],
    ['dateStarted', (l) => l.includes('date started') || l.includes('started')],
    ['dateWorked', (l) => l.includes('date worked') || l.includes('worked')],
    ['timeSpent', (l) => l.includes('time spent') || /\btime\b/.test(l)],
    ['score', (l) => l.includes('score')],
    ['review', (l) => l.includes('review')],
    ['assignment', (l) => l.includes('assignment')],
  ];
  const ITEMS_SCHEMA = 2;

  /**
   * label -> column position map from the table's header row (thead th). Returns null when
   * there is no usable header (then the caller falls back to positional reading). A key that
   * two different header cells claim is ambiguous and left out (=> that field stays null).
   */
  function itemHeaderMap(table) {
    if (!table || typeof table.querySelectorAll !== 'function') return null;
    let rows = Array.from(table.querySelectorAll('thead tr'));
    if (!rows.length) {
      // No <thead>: a leading row made only of <th> cells that isn't a data row.
      const first = Array.from(table.querySelectorAll('tr')).find((tr) => !/^row/.test(tr.id || ''));
      if (first && cellsOf(first).length && cellsOf(first).every((c) => String(c.tagName).toUpperCase() === 'TH')) rows = [first];
    }
    let best = null, bestCount = 0;
    for (const tr of rows) {
      const map = {};
      const dup = new Set();
      let pos = 0;
      for (const c of cellsOf(tr)) {
        const label = cleanText(c.textContent, 80).toLowerCase();
        const rule = label ? ITEM_HEADER_RULES.find(([, test]) => test(label)) : null;
        if (rule) {
          if (map[rule[0]] !== undefined) dup.add(rule[0]);
          else map[rule[0]] = pos;
        }
        pos += spanOf(c);
      }
      for (const k of dup) delete map[k];
      const count = ['correctTotal', 'score', 'timeSpent', 'dateStarted', 'dateWorked'].filter((k) => map[k] !== undefined).length;
      if (count > bestCount) { best = map; bestCount = count; }
    }
    // Need at least two of the data columns to trust the header (else: positional fallback).
    return best && bestCount >= 2 ? best : null;
  }

  const RE_CORRECT_TOTAL = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(\*)?$/;   // "a/b", "a/b*"
  // First "a/b" fraction anywhere in the Correct/Total cell text (tolerates a trailing "*",
  // footnote markers, stray whitespace / markup). Not part of a date: an MM/DD/YY date never matches
  // (no digit/./slash right before it, no "/digit" or more digits right after it).
  const RE_FIRST_FRACTION = /(?<![\d.\/])(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?![\d.]|\s*\/\s*\d)/;
  // Footnote / late-penalty markers that may follow a Correct/Total value ("*", "†", "¹").
  const RE_FOOTNOTE_MARK = /[*\u2020\u2021\u00A7\u00B9\u00B2\u00B3\u2070-\u2079]/;
  const RE_INCOMPLETE = /\bincomplete\b/i;
  const RE_SCORE_PCT = /(\d{1,3}(?:\.\d+)?)\s*%/;                                // "NN.NN%" (anywhere in cell)
  const RE_TIME_SPENT = /^<?\s*(?:\d+\s*(?:h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\.?\s*)+$/i; // hours/minutes text
  const RE_DATE_TIME = /^\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?$/i; // MM/DD/YY plus optional time

  /**
   * One assignment row -> { title, category?, correctTotal?, correctTotalRaw?, note?,
   * scorePercent (number|null), scoreRaw?, status?, timeSpent?, dateStarted?, dateWorked?,
   * omitted?, incomplete? }. Each value comes ONLY from its own column and must pass its
   * format check; anything else is left out (null), never moved to another field.
   */
  function parseItemRow(tr, headerMap) {
    const byPos = cellsByPosition(tr);
    let cell;
    if (headerMap) {
      cell = (k) => (headerMap[k] !== undefined ? byPos[headerMap[k]] || null : null);
    } else {
      // Older/different markup: positional over the <td> cells. The live table has a
      // "Review" <td> before Correct/Total; 6+ tds => skip it. Format checks still guard every slot.
      const tds = tdsOf(tr);
      const off = tds.length >= 6 ? 1 : 0;
      const slots = { correctTotal: off, score: off + 1, timeSpent: off + 2, dateStarted: off + 3, dateWorked: off + 4 };
      cell = (k) => (slots[k] !== undefined ? tds[slots[k]] || null : null);
    }

    const th = tr.querySelector('th.leftcol') || cell('assignment') || tr.querySelector('th');
    if (!th) return null;
    const hidden = th.querySelector('span.readableButHidden');
    const item = { title: cellText(th) };
    if (!item.title) return null;
    const cat = hidden ? cleanText(hidden.textContent, 80).replace(/[:\-–\s]+$/, '') : '';
    if (cat) item.category = cat;

    // Correct/Total: the FIRST fraction in the cell's own text. <sup> footnotes are removed
    // before extraction (so a fraction followed by a <sup> footnote digit can't glue into a different number); a "*" or any
    // footnote marker / <sup> in the cell => asterisk + note 'late'. Raw cell text is kept.
    const ctCell = cell('correctTotal');
    const ctText = spacedCellText(ctCell, 'i, svg, img, .readableButHidden, sup');
    const ct = ctText.match(RE_FIRST_FRACTION);
    if (ct) {
      item.correctTotal = `${ct[1]}/${ct[2]}`;
      const raw = spacedCellText(ctCell, 'i, svg, img, .readableButHidden').replace(/\s+/g, '');
      item.correctTotalRaw = raw.length <= 60 ? raw : item.correctTotal;
      const hasSup = !!(ctCell && ctCell.querySelector && ctCell.querySelector('sup'));
      const afterFraction = ctText.slice(ct.index + ct[0].length);
      if (hasSup || RE_FOOTNOTE_MARK.test(afterFraction) || RE_FOOTNOTE_MARK.test(raw)) {
        item.asterisk = true; item.note = 'late';
        const mark = afterFraction.match(RE_FOOTNOTE_MARK);
        if (hasSup || (mark && mark[0] !== '*')) item.footnote = true; // a footnote, not just "*"
      }
    }

    // Score (percent) + status. "Incomplete" may sit in ANY cell of the row on the live page
    // (seen around the Time Spent column, possibly a merged cell), not only in Score: every
    // cell except the assignment-name cell is checked (case-insensitive, whole word).
    const scoreTd = cell('score');
    const scoreText = spacedCellText(scoreTd, 'i, svg, img, .readableButHidden');
    let incompleteIn = null;
    const byPosEntries = Object.keys(byPos).map(Number).sort((a, b) => a - b);
    for (const pos of byPosEntries) {
      const c = byPos[pos];
      if (c === th) continue; // the title may legitimately contain the word
      if (!RE_INCOMPLETE.test(cellText(c, 'script, style, .readableButHidden'))) continue;
      const key = headerMap ? Object.keys(headerMap).find((k) => headerMap[k] === pos) : null;
      incompleteIn = key || `col${pos}`;
      break;
    }
    const incomplete = incompleteIn !== null;
    if (incomplete) item.incompleteIn = incompleteIn; // diagnostics: which cell said "incomplete"
    const omitted = !incomplete && (/\(\s*omitted\s*\)/i.test(scoreText) || /(^|\s)omit(\s|$)/.test(tr.getAttribute('class') || ''));
    item.scorePercent = null;
    if (!incomplete) {
      const pm = scoreText.match(RE_SCORE_PCT);
      if (pm) { const n = parseFloat(pm[1]); if (Number.isFinite(n)) item.scorePercent = n; }
    }
    if (nonEmpty(scoreText)) item.scoreRaw = cleanText(scoreText, 60);
    if (incomplete) { item.status = 'incomplete'; item.incomplete = true; }
    else if (omitted) { item.status = 'omitted'; item.omitted = true; }
    else if (item.scorePercent !== null || item.correctTotal) item.status = 'graded';
    // (no percent, no count, no marker => status left out rather than guessed)

    // Time spent
    const tSpent = spacedCellText(cell('timeSpent'), 'i, svg, img, .readableButHidden');
    if (RE_TIME_SPENT.test(tSpent)) item.timeSpent = tSpent;

    // Dates (date + time on two visual lines)
    for (const k of ['dateStarted', 'dateWorked']) {
      const v = fixDateTime(spacedCellText(cell(k), 'i, svg, img, .readableButHidden'));
      if (RE_DATE_TIME.test(v)) item[k] = v;
    }
    return item;
  }

  /**
   * Parse a Pearson Results.aspx Document (works with the live page or a test DOM).
   * Returns { overall?, categories?, categoryTotal?, items?, found:{overall,categories,items} }.
   * A part that isn't found is simply absent; nothing is filled in.
   */
  function parsePearsonResultsDocument(doc) {
    const found = { overall: false, categories: false, items: false };
    const res = { found };
    if (!doc || typeof doc.querySelector !== 'function') return res;

    // Overall
    try {
      const overall = {};
      const v = cleanText(doc.querySelector(PEARSON_SEL.overallValue) && doc.querySelector(PEARSON_SEL.overallValue).textContent, 40);
      const vm = v.match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/);
      if (vm) overall.percent = vm[1];
      const details = Array.from(doc.querySelectorAll(PEARSON_SEL.overallDetails)).map((n) => n.textContent).join(' ');
      const d = parsePearsonOverallDetails(details);
      if (d) {
        if (d.earned) { overall.earned = d.earned; overall.total = d.total; }
        if (!overall.percent && d.percent) overall.percent = d.percent;
        if (d.percent && overall.percent && d.percent !== overall.percent) overall.detailsPercent = d.percent; // keep both, don't pick
        overall.detailsText = cleanText(details, 300);
      }
      if (overall.percent || overall.earned) { res.overall = overall; found.overall = true; }
    } catch (_) { /* part missing */ }

    // Category table
    try {
      const table = doc.querySelector(PEARSON_SEL.categoryTable);
      if (table) {
        const cats = [];
        for (const tr of table.querySelectorAll('tbody tr')) {
          const r = parseCategoryRow(tr);
          if (r.name && (r.average || r.weight || r.earned)) cats.push(r);
        }
        const foot = table.querySelector('tfoot tr');
        if (foot) { const t = parseCategoryRow(foot); if (t.average || t.weight || t.earned) res.categoryTotal = t; }
        if (cats.length) { res.categories = cats; found.categories = true; }
      }
    } catch (_) { /* part missing */ }

    // Assignment table(s)
    try {
      const tables = Array.from(doc.querySelectorAll(PEARSON_SEL.itemTable))
        .filter((t) => !t.matches(PEARSON_SEL.categoryTable));
      if (tables.length) {
        const items = [];
        const headerMaps = [];
        for (const table of tables) {
          const hm = itemHeaderMap(table); // null => positional fallback
          headerMaps.push(hm ? Object.keys(hm).sort() : null);
          for (const tr of table.querySelectorAll('tbody tr[id^="row"]')) {
            const it = parseItemRow(tr, hm);
            if (it) items.push(it);
            if (items.length >= 500) break;
          }
        }
        res.items = items;
        res.itemColumns = headerMaps; // which labelled columns were recognised (diagnostics)
        found.items = items.length > 0;
      }
    } catch (_) { /* part missing */ }
    return res;
  }

  // Course identity on Results.aspx lives ONLY in the page footer, in the form:
  //   "This course (<course code> - <title> (<section id>)) is based on ..."
  // => readable title "<course code> - <title>" + UARK section id "<section id>".
  const PEARSON_SECTION_ID_SRC = '\\d{4}_(?:FALL|SPRING|SUMMER|WINTER)_[A-Z]{2,5}_\\d{3,5}_SEC\\w+';
  const PEARSON_SECTION_ID_EXACT = new RegExp('^' + PEARSON_SECTION_ID_SRC + '$', 'i');
  const PEARSON_FOOTER_RE = Object.freeze({
    // Preferred: the whole "This course (<title> (<section id>))" phrase, so the id is tied to the title.
    full: new RegExp('This course\\s*\\(\\s*(.{1,200}?)\\s*\\(\\s*(' + PEARSON_SECTION_ID_SRC + ')\\s*\\)\\s*\\)', 'gi'),
    // Fallback title-only form: text after "This course (" up to the nested "(".
    title: /This course\s*\(\s*(.{1,200}?)\s*\(/gi,
    // Section id anywhere in the body text (used only if the full footer phrase didn't match).
    sectionId: new RegExp('\\b(' + PEARSON_SECTION_ID_SRC + ')\\b', 'gi'),
  });

  /** A UARK section id (YEAR_TERM_SUBJ_NUMBER_SECnnn), upper-cased, or null if it isn't one. */
  function cleanPearsonSectionId(v) {
    const s = str(v).trim();
    return s && s.length <= 60 && PEARSON_SECTION_ID_EXACT.test(s) ? s.toUpperCase() : null;
  }

  /**
   * Read the course identity from the Results.aspx body/footer TEXT (pure; no DOM).
   * Returns { courseTitle, sectionId, ambiguous: { title, sectionId } }. A value is only
   * returned when exactly one distinct candidate exists; several different ones => null
   * (flagged ambiguous) — never a guess.
   */
  function parsePearsonCourseFooter(text) {
    const out = { courseTitle: null, sectionId: null, ambiguous: { title: false, sectionId: false } };
    const t = typeof text === 'string' ? text.replace(/\s+/g, ' ') : '';
    if (!t.trim()) return out;
    const titles = new Set();
    const footerIds = new Set();
    for (const m of t.matchAll(PEARSON_FOOTER_RE.full)) {
      const title = cleanText(m[1], 160);
      if (title) titles.add(title);
      footerIds.add(m[2].toUpperCase());
    }
    if (!titles.size) {
      for (const m of t.matchAll(PEARSON_FOOTER_RE.title)) { const title = cleanText(m[1], 160); if (title) titles.add(title); }
    }
    let ids = footerIds;
    if (!ids.size) {
      ids = new Set();
      for (const m of t.matchAll(PEARSON_FOOTER_RE.sectionId)) ids.add(m[1].toUpperCase());
    }
    if (titles.size === 1) out.courseTitle = [...titles][0];
    else if (titles.size > 1) out.ambiguous.title = true;
    if (ids.size === 1) out.sectionId = cleanPearsonSectionId([...ids][0]);
    else if (ids.size > 1) out.ambiguous.sectionId = true;
    return out;
  }

  /**
   * Build a Pearson gradebook record from what the content script parsed.
   * parsed = { key, courseTitle, courseSectionId, pageUrl, overall?, categories?, categoryTotal?, items?, found }
   * Key: 'section:<UARK section id>' when the footer gave one, else parsed.key (URL course id),
   * else 'title:<course title>'. Returns null if NOTHING usable was parsed, or if there is no
   * course identity at all (no section id, no key, no title) — caller must not overwrite cache.
   * Every record is tagged source:'pearson' + syncedAt.
   */
  function normalizePearson(parsed) {
    if (!isObj(parsed)) return null;
    const sectionId = cleanPearsonSectionId(parsed.courseSectionId);
    const rec = {
      verified: true,
      source: SOURCES.PEARSON,
      syncedAt: nowIso(),
      key: sectionId ? 'section:' + sectionId : (str(parsed.key) || null),
      provider: 'Pearson MyLab',
      pearsonCourseTitle: cleanText(parsed.courseTitle, 160) || null,
      pearsonSectionId: sectionId,
      pageUrl: null,
    };
    try { const u = new URL(parsed.pageUrl); rec.pageUrl = u.origin + u.pathname; } catch (_) { /* omit */ }

    const o = isObj(parsed.overall) ? parsed.overall : null;
    const parsedParts = { overall: false, categories: false, items: false };
    if (o) {
      const ov = {};
      if (/^\d{1,3}(\.\d+)?$/.test(str(o.percent))) ov.percent = str(o.percent);
      if (/^\d+(\.\d+)?$/.test(str(o.earned)) && /^\d+(\.\d+)?$/.test(str(o.total))) { ov.earned = str(o.earned); ov.total = str(o.total); }
      if (/^\d{1,3}(\.\d+)?$/.test(str(o.detailsPercent))) ov.detailsPercent = str(o.detailsPercent);
      if (nonEmpty(o.detailsText)) ov.detailsText = cleanText(o.detailsText, 300);
      if (ov.percent || ov.earned) {
        rec.overall = ov;
        if (ov.percent) rec.currentGrade = `${ov.percent}%`;
        if (ov.earned) rec.overallPoints = `${ov.earned} / ${ov.total} pts`;
        parsedParts.overall = true;
      }
    }

    const cleanCat = (c) => {
      if (!isObj(c) || !nonEmpty(c.name)) return null;
      const r = { name: cleanText(c.name, 80) };
      for (const k of ['average', 'weight', 'earned', 'timeSpent']) if (nonEmpty(c[k])) r[k] = cleanText(c[k], 40);
      return r.average || r.weight || r.earned ? r : null;
    };
    const cats = (Array.isArray(parsed.categories) ? parsed.categories : []).map(cleanCat).filter(Boolean);
    if (cats.length) { rec.categories = cats; parsedParts.categories = true; }
    const tot = cleanCat(parsed.categoryTotal);
    if (tot && cats.length) rec.categoryTotal = tot;

    const items = [];
    for (const it of Array.isArray(parsed.items) ? parsed.items : []) {
      if (!isObj(it) || !nonEmpty(it.title)) continue;
      const x = { title: cleanText(it.title, 160), verified: true, source: SOURCES.PEARSON, syncedAt: rec.syncedAt };
      if (nonEmpty(it.category)) x.category = cleanText(it.category, 80);
      // Each field re-checked against its own format; a value that fails is left out (null).
      const ct = str(it.correctTotal).match(RE_CORRECT_TOTAL);
      if (ct) {
        x.correctTotal = `${ct[1]}/${ct[2]}`;
        const raw = str(it.correctTotalRaw).replace(/\s+/g, '');
        // Raw is kept only if it really contains this fraction (the fraction followed by "*" or a footnote digit).
        const rawFrac = raw.length <= 60 ? raw.match(RE_FIRST_FRACTION) : null;
        if (rawFrac && `${rawFrac[1]}/${rawFrac[2]}` === x.correctTotal) x.correctTotalRaw = raw;
        if (ct[3] || it.asterisk === true || it.note === 'late' || (x.correctTotalRaw && RE_FOOTNOTE_MARK.test(x.correctTotalRaw))) { x.asterisk = true; x.note = 'late'; }
        if (x.asterisk && it.footnote === true) x.footnote = true;
      }
      const status = ['graded', 'omitted', 'incomplete'].includes(it.status) ? it.status : null;
      if (status) x.status = status;
      // Never a percent for an incomplete row.
      x.scorePercent = status !== 'incomplete' && finite(it.scorePercent) && it.scorePercent >= 0 && it.scorePercent <= 1000 ? it.scorePercent : null;
      if (nonEmpty(it.scoreRaw)) x.scoreRaw = cleanText(it.scoreRaw, 60);
      if (RE_TIME_SPENT.test(str(it.timeSpent))) x.timeSpent = cleanText(it.timeSpent, 40);
      for (const k of ['dateStarted', 'dateWorked']) { const v = fixDateTime(it[k]); if (RE_DATE_TIME.test(v)) x[k] = v; }
      if (status === 'omitted') x.omitted = true;
      if (status === 'incomplete') {
        x.incomplete = true;
        if (/^[A-Za-z][A-Za-z0-9]{0,20}$/.test(str(it.incompleteIn))) x.incompleteIn = str(it.incompleteIn);
      }
      items.push(x);
      if (items.length >= 500) break;
    }
    if (items.length) parsedParts.items = true;
    rec.items = items;
    rec.itemsSchema = ITEMS_SCHEMA; // 2 = header-mapped columns (correctTotal / scorePercent / dateStarted / dateWorked)
    rec.itemsSynced = items.length > 0;
    rec.parsed = parsedParts;
    rec.parseMissing = Object.keys(parsedParts).filter((k) => !parsedParts[k]);

    if (!parsedParts.overall && !parsedParts.categories && !parsedParts.items) return null;
    if (!rec.key) rec.key = rec.pearsonCourseTitle ? 'title:' + rec.pearsonCourseTitle.toLowerCase() : null;
    return rec.key ? rec : null;
  }

  /**
   * Merge a fresh Pearson record over the cached one for the same key: a part the
   * new parse missed keeps the previous good value, marked stale (never guessed).
   */
  function mergePearsonRecord(prev, next) {
    if (!isObj(next)) return prev || null;
    if (!isObj(prev) || !isObj(prev.parsed)) return next;
    const PARTS = { overall: ['overall', 'currentGrade', 'overallPoints'], categories: ['categories', 'categoryTotal'], items: ['items', 'itemsSynced', 'itemsSchema'] };
    const out = { ...next, parsed: { ...(next.parsed || {}) }, staleParts: [] };
    for (const [part, fields] of Object.entries(PARTS)) {
      if (out.parsed[part] || !prev.parsed[part]) continue;
      // Assignment lists cached by the old positional parser put Correct/Total in the Score
      // field; never carry those forward.
      if (part === 'items' && prev.itemsSchema !== ITEMS_SCHEMA) continue;
      for (const f of fields) if (prev[f] !== undefined) out[f] = prev[f];
      out.parsed[part] = true;
      out.staleParts.push({ part, syncedAt: prev.syncedAt || null });
    }
    if (!out.staleParts.length) delete out.staleParts;
    return out;
  }

  /**
   * Decide which Blackboard course a Pearson record belongs to.
   * Order: user's explicit mapping (prefs) > exact UARK section id from the Pearson footer
   * (Blackboard bbId, then course code "SUBJ NUMBER-SECTION") > subject+number code in the
   * Pearson title > a keyword that matches exactly one synced course. Ambiguous => unmatched.
   * When the section is known, the fallbacks never pick a course whose code names a
   * DIFFERENT section than the footer names.
   */
  function matchPearsonToCourse(rec, courses, overrides) {
    if (!isObj(rec)) return null;
    let list = (Array.isArray(courses) ? courses : []).filter((c) => isObj(c) && nonEmpty(c.code));
    if (isObj(overrides) && nonEmpty(overrides[rec.key])) {
      const c = list.find((x) => x.id === overrides[rec.key]);
      if (c) return { courseId: c.id, matchedBy: 'your manual mapping' };
    }
    const title = str(rec.pearsonCourseTitle);
    const norm = (v) => str(v).replace(/\s+/g, ' ').trim().toUpperCase();
    const sectionId = cleanPearsonSectionId(rec.pearsonSectionId);
    const sectionCode = sectionId ? courseCodeFromId(sectionId) : null;
    if (sectionCode) {
      // The page contradicting itself (title names one section, footer id another) => don't guess.
      const sc = sectionCode.match(/^([A-Z]{2,5}) (\d{4,5})-(\w+)$/);
      const titleConflict = [...title.matchAll(/\b([A-Z]{2,5})\s*(\d{4,5})-([A-Z0-9]{1,6})\b/gi)]
        .some((m) => m[1].toUpperCase() === sc[1] && m[2] === sc[2] && m[3].toUpperCase() !== sc[3]);
      if (titleConflict) return null;
      const matchedBy = `section id "${sectionId}" from the Pearson page footer`;
      const byBbId = list.filter((c) => norm(c.bbId) === sectionId);
      if (byBbId.length === 1) return { courseId: byBbId[0].id, matchedBy };
      const byCode = list.filter((c) => norm(c.code) === sectionCode);
      if (byCode.length === 1) return { courseId: byCode[0].id, matchedBy };
      // Known section but no unique exact hit: fallbacks may only consider courses whose code
      // is that same section or isn't a full UARK section code at all.
      list = list.filter((c) => !/^[A-Z]{2,5} \d{4,5}-\w+$/.test(norm(c.code)) || norm(c.code) === sectionCode);
    }
    const subjNum = (code) => { const m = str(code).match(/^([A-Z]{2,5})\s*(\d{4,5})/i); return m ? (m[1] + m[2]).toUpperCase() : null; };
    const re = /\b([A-Z]{2,5})\s*-?\s*(\d{4,5})\b/gi;
    let m;
    while ((m = re.exec(title))) {
      const key = (m[1] + m[2]).toUpperCase();
      const hits = list.filter((c) => subjNum(c.code) === key);
      if (hits.length === 1) return { courseId: hits[0].id, matchedBy: `course code "${m[1]} ${m[2]}" in the Pearson course title` };
    }
    const KW = [
      { re: /econ|macro|micro/i, subj: 'ECON' },
      { re: /\bmath|finite|algebra|calculus|statistic/i, subj: 'MATH' },
    ];
    for (const k of KW) {
      const hit = title.match(k.re);
      if (!hit) continue;
      const hits = list.filter((c) => str(c.code).toUpperCase().startsWith(k.subj + ' ') && c.current !== false);
      if (hits.length === 1) return { courseId: hits[0].id, matchedBy: `keyword "${hit[0]}" in the Pearson course title` };
    }
    return null;
  }

  // ---------------------------------------------------------- dashboard view

  /** Empty, honest default: nothing synced. Never sample data. */
  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      _meta: { empty: true, source: null, pulled_at: null },
      student: null,
      term: null,
      courses: [],
      unmatchedPearson: [],
      status: {},
    };
  }

  /**
   * Combine stored pieces into the shape the dashboard renders
   * (same shape as blackboard-mirror/data/courses.json, plus provenance fields).
   */
  function mergeForDashboard(store) {
    const s = isObj(store) ? store : {};
    const bb = isObj(s[STORAGE_KEYS.blackboard]) ? s[STORAGE_KEYS.blackboard] : null;
    const pe = isObj(s[STORAGE_KEYS.pearson]) && isObj(s[STORAGE_KEYS.pearson].records) ? s[STORAGE_KEYS.pearson].records : {};
    const status = isObj(s[STORAGE_KEYS.status]) ? s[STORAGE_KEYS.status] : {};
    const prefs = isObj(s[STORAGE_KEYS.prefs]) ? s[STORAGE_KEYS.prefs] : {};
    const out = emptyState();
    out.status = status;
    if (bb) {
      out._meta = { ...bb._meta, empty: !(bb.courses && bb.courses.length) };
      // Old caches may hold names built from name.preferredDisplayName ("GivenName"): drop them (=> not synced).
      out.student = bb.student && !isPlaceholderName(bb.student.name) ? bb.student : null;
      out.terms = bb.terms || {};
      out.courses = (bb.courses || []).filter(isObj).map((c) => {
        const cc = { ...c };
        if (Array.isArray(c.faculty)) {
          const kept = c.faculty.filter((f) => isObj(f) && !isPlaceholderName(f.name));
          const dropped = c.faculty.length - kept.length;
          cc.faculty = kept;
          if (dropped) cc.facultyUnnamed = (c.facultyUnnamed || 0) + dropped;
        }
        return cc;
      });
    }
    const byId = {};
    for (const c of out.courses) byId[c.id] = c;
    for (const rec of Object.values(pe)) {
      if (!isObj(rec)) continue;
      const match = matchPearsonToCourse(rec, out.courses, prefs.pearsonMap);
      if (match && byId[match.courseId]) {
        const c = byId[match.courseId];
        c.pearson = { ...rec, matchedBy: match.matchedBy };
      } else {
        out.unmatchedPearson.push(rec);
      }
    }
    // Single term label only if every current course shares one synced term name.
    const names = [...new Set(out.courses.filter((c) => c.current !== false).map((c) => c.termName).filter(Boolean))];
    out.term = names.length === 1 ? names[0] : null;
    return out;
  }

  const api = {
    SCHEMA_VERSION, BB_ORIGIN, STORAGE_KEYS, SOURCES,
    stripHtml, cleanText, safeUrl, colorFor, courseCodeFromId, contentType,
    section, personName, isPlaceholderName, studentFromMe, courseStatus, courseFromMembership, normalizeTerm, termIsCurrent,
    facultyInfo, facultyFrom, contentFrom, gradeText, findOverallColumn, gradebookFrom, dueStatus, upcomingFrom, calendarByCourse,
    normalizeBlackboard, normalizeDomCourses, mergeBlackboard,
    PEARSON_SEL, ITEMS_SCHEMA, parsePearsonOverallDetails, parsePearsonResultsDocument, spacedCellText, fixDateTime, cleanPearsonSectionId, parsePearsonCourseFooter, normalizePearson, mergePearsonRecord, matchPearsonToCourse,
    emptyState, mergeForDashboard,
  };
  root.BBX = Object.freeze(api);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
