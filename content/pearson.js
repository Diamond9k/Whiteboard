/*
 * content/pearson.js — runs on Pearson MyLab pages (mylab.pearson.com, *.pearson.com),
 * in all frames, because MyLab often renders the gradebook inside an iframe.
 *
 * Only acts on a results/gradebook page (e.g. /Student/Results.aspx). It reads
 * what is on the page while the student is signed in, using the real Results.aspx
 * selectors (see BBX.PEARSON_SEL / parsePearsonResultsDocument in
 * shared/normalize.js): overall score (#overallScore .score-value +
 * #overall-score-details), the category table (OverallScoreGrid: avg %, weight,
 * points earned, time) and the assignment table (table.table-inner-bordered rows
 * tr[id^=row]). The course is identified from the page footer text
 * ("This course (<course code> - <title> (<section id>))"). Nothing is inferred. If nothing recognisable is found, NOTHING is
 * stored (the cache is kept) and 'parse-failed' is reported; if only some parts
 * were found, those are stored and 'parse-partial' is reported, so the dashboard
 * keeps its "couldn't be read" banner.
 *
 * READ-ONLY: this script never clicks, submits, or fetches anything.
 * CAVEAT: Pearson markup is undocumented and can change; on any miss we report it, never guess.
 */
(() => {
  'use strict';
  if (window.__bbxPearsonLoaded) return;
  window.__bbxPearsonLoaded = true;

  const BBX = globalThis.BBX;
  if (!BBX) return;
  const log = (...a) => console.debug('[BBX pearson]', ...a);

  const path = location.pathname.toLowerCase();
  const host = location.hostname.toLowerCase();
  const isResultsPage = /\/student\/results\.aspx/.test(path) || /\/(gradebook|results)(\/|$|\.aspx)/.test(path);
  const isLoginPage = /^login\./.test(host) || /\/(login|signin|sign-in)(\/|$|\.)/.test(path);

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => { if (chrome.runtime.lastError) { resolve(null); return; } resolve(resp || null); });
      } catch (_) { resolve(null); }
    });
  }
  const reportStatus = (state, extra = {}) => send({ type: 'bbx:status', system: 'pearson', status: { state, at: new Date().toISOString(), ...extra } });

  if (isLoginPage && window.top === window) {
    reportStatus('session-expired', { message: 'Pearson sign-in page detected. Cached Pearson data kept.' });
    return;
  }
  if (!isResultsPage) return;

  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /**
   * Visible page text for the footer reader. innerText first (what's rendered); if that's
   * empty (e.g. hidden frame), the raw textContent. Read-only.
   */
  function pageText() {
    let t = '';
    try { t = (document.body && document.body.innerText) || ''; } catch (_) { /* no body */ }
    if (!t.trim()) { try { t = (document.documentElement && document.documentElement.textContent) || ''; } catch (_) { /* none */ } }
    return t;
  }

  /**
   * Course identity from the footer "This course (<course code> - <title>
   * (<section id>)) is based on ..." — the only place Results.aspx shows it.
   * Pure parsing lives in BBX.parsePearsonCourseFooter (tested); a value is only returned
   * when exactly one distinct candidate is on the page.
   */
  function readFooter() {
    try { return BBX.parsePearsonCourseFooter(pageText()); } catch (_) { return { courseTitle: null, sectionId: null, ambiguous: {} }; }
  }

  /** Pearson course title: footer first (reliable on Results.aspx), then known-ish ids, then document.title. */
  function findCourseTitle(footer) {
    if (footer && footer.courseTitle) return footer.courseTitle;
    const sels = [
      '[id$="lblCourseName"]', '[id*="CourseName"]', '#courseName', '.course-name', '.courseName',
      '[data-testid*="course-name"]', '#ctl00_ctl00_InsideForm_MasterContent_lblCourse',
    ];
    for (const s of sels) {
      try { const t = text(document.querySelector(s)); if (t && t.length < 200) return t; } catch (_) { /* bad selector */ }
    }
    // Some frames only expose it in the top-level title; same-origin frames only.
    const t = (document.title || '').replace(/\s*[|\-–]\s*(results|gradebook|mylab.*)$/i, '').trim();
    return t && !/^(results|gradebook)$/i.test(t) ? t : '';
  }

  /** Stable key: UARK section id from the footer, else course id from the URL, else the course title. */
  function findKey(courseTitle, sectionId) {
    if (sectionId) return 'section:' + sectionId;
    const p = new URLSearchParams(location.search);
    for (const k of ['courseId', 'CourseId', 'courseid', 'cid', 'CourseID']) if (p.get(k)) return 'course:' + p.get(k);
    return courseTitle ? 'title:' + courseTitle.toLowerCase() : '';
  }

  let done = false;
  const PART_LABEL = { overall: 'overall score', categories: 'category table', items: 'assignment table' };

  async function attempt(n) {
    if (done) return;
    const final = n === 'final';
    try {
      const footer = readFooter();
      const courseSectionId = footer.sectionId || '';
      const courseTitle = findCourseTitle(footer);
      const parsed = BBX.parsePearsonResultsDocument(document);
      const found = parsed.found || {};
      const complete = !!(found.overall && found.categories && found.items);
      // MyLab renders late: wait for a complete page unless this is the last try.
      if (!complete && !final) return;
      const rec = BBX.normalizePearson({ ...parsed, key: findKey(courseTitle, courseSectionId), courseTitle, courseSectionId, pageUrl: location.href });
      if (!rec) {
        if (final) {
          const anyFound = found.overall || found.categories || found.items;
          // normalizePearson only drops a parsed page when there's no course identity at all
          // (no footer section id, no course title, no URL course id).
          const noIdentity = anyFound && !courseSectionId && !courseTitle;
          const amb = footer.ambiguous || {};
          const ambNote = amb.sectionId || amb.title ? ' The page listed more than one different course, so none was picked.' : '';
          await reportStatus('parse-failed', {
            message: noIdentity
              ? `Results page was read, but the Pearson course could not be identified (no "This course (...)" footer / section id, no course title, no course id in the URL).${ambNote} Nothing stored; cached data kept.`
              : "Results page found, but the overall score, category table and assignment table couldn't be read. Pearson markup may have changed. Cached data kept.",
          });
        }
        return;
      }
      done = true;
      const missing = rec.parseMissing || [];
      const resp = await send({ type: 'bbx:storePearson', record: rec });
      const state = !(resp && resp.ok) ? 'store-failed' : missing.length ? 'parse-partial' : 'ok';
      await reportStatus(state, {
        source: BBX.SOURCES.PEARSON,
        lastSuccessAt: resp && resp.ok ? new Date().toISOString() : undefined,
        counts: { categories: (rec.categories || []).length, items: rec.items.length, overall: !!rec.overall },
        missing,
        message: missing.length ? `Couldn't read the ${missing.map((k) => PART_LABEL[k] || k).join(', ')} on the Pearson results page. Stored only what was read.` : undefined,
        course: rec.pearsonCourseTitle || null,
        sectionId: rec.pearsonSectionId || null,
      });
    } catch (e) {
      log('parse crashed', e);
      if (final) reportStatus('error', { message: String(e && e.message ? e.message : e) });
    }
  }

  // MyLab often renders late; retry a few times, then report if nothing matched.
  [1500, 4000, 8000].forEach((ms, i, arr) => setTimeout(() => attempt(i === arr.length - 1 ? 'final' : i), ms));

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'bbx:sync') return false;
    done = false;
    attempt('final').then(() => sendResponse({ ok: done }), () => sendResponse({ ok: false }));
    return true;
  });
})();
