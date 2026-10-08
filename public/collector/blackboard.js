/*
 * Blackboard collector. Paste this into the DevTools console on https://learn.uark.edu
 * while you are signed in.
 *
 * READ-ONLY. Every request uses method GET. This file never POSTs, clicks, or submits.
 * It downloads the raw responses. The dashboard interprets them on import.
 */
(function () {
  "use strict";
  if (window.__mirrorBlackboardCollecting) {
    console.warn("Blackboard collector is already running.");
    return;
  }
  if (location.origin !== "https://learn.uark.edu") {
    console.error("Run this on https://learn.uark.edu while signed in. Nothing was saved.");
    return;
  }
  window.__mirrorBlackboardCollecting = true;

  var TIMEOUT = 15000;
  var MAX_PAGES = 20;
  var MAX_COURSES = 15;
  var MAX_FOLDER_READS = 40;
  var MAX_NAME_LOOKUPS = 6;

  function log() {
    console.log.apply(console, ["[mirror]"].concat([].slice.call(arguments)));
  }

  function HttpError(kind, status, url) {
    this.kind = kind;
    this.status = status;
    this.message = kind + " (" + status + ") " + url;
  }

  function getJSON(path) {
    var url = new URL(path, location.origin);
    if (url.origin !== location.origin) return Promise.reject(new HttpError("cross-origin-blocked", 0, path));
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    return fetch(url.href, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    }).then(function (res) {
      clearTimeout(timer);
      var ct = res.headers.get("content-type") || "";
      if (res.redirected && !/\/learn\/api\//.test(new URL(res.url).pathname)) throw new HttpError("auth", res.status, url.pathname);
      if (res.status === 401) throw new HttpError("auth", 401, url.pathname);
      if (res.status === 403) throw new HttpError("forbidden", 403, url.pathname);
      if (res.status === 404) throw new HttpError("not-found", 404, url.pathname);
      if (!res.ok) throw new HttpError("error", res.status, url.pathname);
      if (!/json/i.test(ct)) throw new HttpError(/html/i.test(ct) ? "auth" : "bad-content-type", res.status, url.pathname);
      return res.json();
    }).catch(function (err) {
      clearTimeout(timer);
      if (err instanceof HttpError) throw err;
      throw new HttpError(err && err.name === "AbortError" ? "timeout" : "network", 0, url.pathname);
    });
  }

  function getAll(path) {
    var next = path;
    var pages = 0;
    var all = [];
    function step() {
      if (!next || pages >= MAX_PAGES) return Promise.resolve(all);
      return getJSON(next).then(function (body) {
        if (body && Array.isArray(body.results)) all = all.concat(body.results);
        else if (Array.isArray(body)) all = all.concat(body);
        var np = body && body.paging && typeof body.paging.nextPage === "string" ? body.paging.nextPage : null;
        next = np && np.charAt(0) === "/" ? np : null;
        pages += 1;
        return step();
      });
    }
    return step();
  }

  function firstOk(candidates, fn) {
    var index = 0;
    var last = null;
    var kinds = [];
    function attempt() {
      if (index >= candidates.length) {
        var err = last || new HttpError("error", 0, "no candidates");
        if (kinds.length && kinds.every(function (kind) { return kind === "auth"; })) err.kind = "auth";
        else if (kinds.indexOf("forbidden") >= 0) err.kind = "forbidden";
        throw err;
      }
      var path = candidates[index++];
      return fn(path).then(function (data) {
        return data;
      }).catch(function (err) {
        last = err;
        kinds.push(err.kind || "error");
        return attempt();
      });
    }
    return attempt();
  }

  function sectionFetch(candidates, fn) {
    return firstOk(candidates, fn).then(function (data) {
      return { state: "ok", data: data, syncedAt: new Date().toISOString() };
    }).catch(function (err) {
      return { state: err.kind || "error", error: String(err && err.message || err).slice(0, 200), syncedAt: new Date().toISOString() };
    });
  }

  function pool(items, n, worker) {
    var out = new Array(items.length);
    var cursor = 0;
    function run() {
      if (cursor >= items.length) return Promise.resolve();
      var index = cursor++;
      return worker(items[index], index).then(function (value) {
        out[index] = value;
        return run();
      });
    }
    var runners = [];
    for (var i = 0; i < Math.min(n, items.length); i++) runners.push(run());
    return Promise.all(runners).then(function () { return out; });
  }

  function enc(value) { return encodeURIComponent(value); }

  function looksLikeLogin() {
    return /^\/webapps\/login/i.test(location.pathname) || /\/auth-saml\//i.test(location.pathname) || !!document.querySelector("form#login-form, form[name='login'], input[type='password']");
  }

  function personName(user) {
    if (!user || typeof user !== "object") return "";
    var name = user.name && typeof user.name === "object" ? user.name : {};
    var given = name.given || user.givenName || "";
    var family = name.family || user.familyName || "";
    if (/^(given\s*name|family\s*name|preferred\s*name|middle\s*name)$/i.test(given)) given = "";
    if (/^(given\s*name|family\s*name|preferred\s*name|middle\s*name)$/i.test(family)) family = "";
    return [given, family].filter(Boolean).join(" ").trim();
  }

  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function finish(capture) {
    download("blackboard-capture.json", capture);
    log("Saved blackboard-capture.json (" + capture.mode + "). Import it into Mirror. Nothing was submitted.");
    window.__mirrorBlackboardCollecting = false;
  }

  function fail(state, message) {
    finish({
      kind: "blackboard-capture",
      collector: "blackboard-console",
      collectorVersion: 1,
      capturedAt: new Date().toISOString(),
      origin: location.origin,
      mode: "error",
      error: { state: state, message: message },
      me: null,
      memberships: [],
      terms: {},
      calendar: null,
      details: {},
      domCards: null,
    });
  }

  function scrapeCards() {
    var cards = [];
    var nodes = document.querySelectorAll("[id^='course-list-course-'], [data-course-id], article.course-element-card, .course-element-card");
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var id = el.getAttribute("data-course-id") || "";
      if (!id) {
        var match = (el.id || "").match(/course-list-course-(_\d+_\d+)/);
        if (match) id = match[1];
      }
      if (!id || seen[id]) continue;
      var titleNode = el.querySelector(".js-course-title-element, h4.course-title, [class*='course-title'], h4, h3");
      var title = titleNode ? titleNode.textContent : "";
      if (!title || !title.trim()) continue;
      seen[id] = true;
      var idNode = el.querySelector(".course-id, [class*='course-id']");
      var instructorNode = el.querySelector(".instructors, [class*='instructor']");
      var body = (el.textContent || "").toLowerCase();
      cards.push({
        id: id,
        title: title,
        bbId: idNode && idNode.textContent ? idNode.textContent.trim() : null,
        instructor: instructorNode && instructorNode.textContent ? instructorNode.textContent : null,
        closed: /\b(private|closed|unavailable|not open)\b/.test(body) ? true : null,
      });
    }
    return cards;
  }

  function isFolder(item) {
    var id = item && item.contentHandler && item.contentHandler.id ? String(item.contentHandler.id) : "";
    return /x-bb-folder|x-bb-lesson|x-bb-module|learning-module/.test(id);
  }

  if (looksLikeLogin()) {
    fail("auth", "Blackboard login page detected.");
    return;
  }

  log("Reading Blackboard with GET requests. This does not submit anything.");
  var nameCache = {};
  var nameLookups = 0;

  getJSON("/learn/api/public/v1/users/me").catch(function () {
    return getJSON("/learn/api/v1/users/me");
  }).then(function (me) {
    if (!me || !me.id) throw new HttpError("bad-json", 200, "users/me");
    var uid = enc(me.id);
    return firstOk([
      "/learn/api/public/v1/users/" + uid + "/courses?expand=course&limit=100",
      "/learn/api/v1/users/" + uid + "/memberships?expand=course&limit=100",
    ], getAll).then(function (memberships) {
      var termIds = [];
      memberships.forEach(function (row) {
        var id = row && row.course && row.course.termId;
        if (id && termIds.indexOf(id) < 0) termIds.push(id);
      });
      return pool(termIds, 2, function (tid) {
        return sectionFetch(["/learn/api/public/v1/terms/" + enc(tid), "/learn/api/v1/terms/" + enc(tid)], getJSON).then(function (section) {
          return { id: tid, section: section };
        });
      }).then(function (termRows) {
        var terms = {};
        termRows.forEach(function (row) { if (row && row.section && row.section.state === "ok") terms[row.id] = row.section.data; });
        var detailIds = memberships.map(function (row) { return row && row.course && row.course.id; }).filter(Boolean).slice(0, MAX_COURSES);
        var folderReads = 0;
        function readChildren(courseId, item, depth) {
          if (!isFolder(item) || !item.id || depth >= 2) return Promise.resolve(item);
          if (folderReads >= MAX_FOLDER_READS) {
            item._children = { state: "not-fetched", error: "Stopped at 40 folder reads.", syncedAt: new Date().toISOString() };
            return Promise.resolve(item);
          }
          folderReads += 1;
          return sectionFetch(["/learn/api/public/v1/courses/" + enc(courseId) + "/contents/" + enc(item.id) + "/children?limit=200"], getAll).then(function (section) {
            item._children = section;
            if (section.state !== "ok" || !Array.isArray(section.data)) return item;
            return pool(section.data, 2, function (child) { return readChildren(courseId, child, depth + 1); }).then(function () { return item; });
          });
        }
        return pool(detailIds, 2, function (cid) {
          var c = enc(cid);
          return Promise.all([
            sectionFetch([
              "/learn/api/public/v1/courses/" + c + "/users?role=Instructor&expand=user&limit=50",
              "/learn/api/public/v1/courses/" + c + "/users?role=Instructor&limit=50",
              "/learn/api/v1/courses/" + c + "/memberships?expand=user&role=Instructor&limit=50",
            ], getAll),
            sectionFetch(["/learn/api/public/v1/courses/" + c + "/contents?limit=200"], getAll),
            sectionFetch([
              "/learn/api/public/v2/courses/" + c + "/gradebook/columns?limit=200",
              "/learn/api/public/v1/courses/" + c + "/gradebook/columns?limit=200",
            ], getAll),
            sectionFetch([
              "/learn/api/public/v2/courses/" + c + "/gradebook/users/" + uid,
              "/learn/api/public/v1/courses/" + c + "/gradebook/users/" + uid,
            ], getJSON),
          ]).then(function (parts) {
            var faculty = parts[0];
            var contents = parts[1];
            var columns = parts[2];
            var grades = parts[3];
            var entries = faculty.state === "ok" && Array.isArray(faculty.data) ? faculty.data : [];
            return pool(entries, 1, function (entry) {
              if (!entry || personName(entry.user) || !entry.userId || nameLookups >= MAX_NAME_LOOKUPS) return entry;
              if (Object.prototype.hasOwnProperty.call(nameCache, entry.userId)) {
                if (nameCache[entry.userId]) entry.user = nameCache[entry.userId];
                return entry;
              }
              nameLookups += 1;
              return getJSON("/learn/api/public/v1/users/" + enc(entry.userId) + "?fields=name").then(function (user) {
                nameCache[entry.userId] = user;
                if (personName(user)) entry.user = user;
                return entry;
              }).catch(function () {
                nameCache[entry.userId] = null;
                return entry;
              });
            }).then(function () {
              if (contents.state === "ok" && Array.isArray(contents.data)) {
                return pool(contents.data, 2, function (item) { return readChildren(cid, item, 0); }).then(function () {
                  return { faculty: faculty, contents: contents, columns: columns, grades: grades };
                });
              }
              return { faculty: faculty, contents: contents, columns: columns, grades: grades };
            });
          });
        }).then(function (detailRows) {
          var details = {};
          detailIds.forEach(function (id, index) { details[id] = detailRows[index]; });
          var since = new Date(Date.now() - 14 * 864e5);
          var until = new Date(since.getTime() + 16 * 7 * 864e5 - 60e3);
          return sectionFetch([
            "/learn/api/public/v1/calendars/items",
            "/learn/api/public/v1/calendars/items?since=" + enc(since.toISOString()) + "&until=" + enc(until.toISOString()),
          ], getAll).then(function (calendar) {
            finish({
              kind: "blackboard-capture",
              collector: "blackboard-console",
              collectorVersion: 1,
              capturedAt: new Date().toISOString(),
              origin: location.origin,
              mode: "api",
              error: null,
              me: me,
              memberships: memberships,
              terms: terms,
              calendar: calendar,
              details: details,
              domCards: null,
            });
          });
        });
      });
    });
  }).catch(function (err) {
    if (err && err.kind === "auth") {
      fail("auth", "Blackboard API returned 401 or a login page.");
      return;
    }
    var cards = scrapeCards();
    if (cards.length) {
      var nameEl = document.querySelector(".base-navigation-profile-name, [class*='profile-name'], #profile-name");
      finish({
        kind: "blackboard-capture",
        collector: "blackboard-console",
        collectorVersion: 1,
        capturedAt: new Date().toISOString(),
        origin: location.origin,
        mode: "dom",
        error: { state: "error", message: "API failed (" + (err && err.message ? err.message : err) + "). Course cards were read from the page." },
        me: null,
        domStudentName: nameEl ? nameEl.textContent : "",
        memberships: [],
        terms: {},
        calendar: null,
        details: {},
        domCards: cards,
      });
      return;
    }
    fail("error", "API failed (" + (err && err.message ? err.message : err) + "). Open the courses page and run this again for the page fallback.");
  });
})();
