# UARK Blackboard Dashboard: Feature Index (v0.1.4)

This is the source of truth for what exists. If it disagrees with the code, the code wins: fix this file.

## Part 1: Strict feature index

### Architecture and data flow
```
content scripts (read my signed-in session, GET-only, same-origin fetch)
   → background service worker (sole writer; validates origin; merges; never loses good cache)
   → chrome.storage.local
   → dashboard (React, static bundle): loadData() → BBX.mergeForDashboard() → views → #view
```
Shared logic lives in `shared/normalize.js` and is exposed as the single global `globalThis.BBX`. It is also exported through `module.exports` for Node tests.

### Manifest and permissions (`manifest.json`)
- `manifest_version: 3`, name "UARK Blackboard Dashboard (personal)", `minimum_chrome_version: 116`.
- permissions: `storage` and `alarms` only. No `tabs`, no `<all_urls>`.
- host_permissions: `https://learn.uark.edu/*`, `https://mylab.pearson.com/*`, `https://*.pearson.com/*`.
- content_scripts:
  - `learn.uark.edu` → `shared/normalize.js` + `content/blackboard.js` (`document_idle`, top frame only).
  - `*.pearson.com` → `shared/normalize.js` + `content/pearson.js` (`all_frames: true`).
- background: `background.js` runs as a classic worker so it can use `importScripts('shared/normalize.js')`.
- `chrome_url_overrides.newtab` points to `dashboard.html`. The action popup is `popup/popup.html`. CSP: `script-src 'self'; object-src 'self'`.

### Blackboard content script (`content/blackboard.js`)
- Runs in the top frame only, with a double-injection guard.
- `getJSON()` is GET-only with a 15s timeout and login-redirect detection. Error states:
  - a redirect off `/learn/api/`, or HTML served as a 200 → `auth`
  - `401` → `auth`
  - `403` → `forbidden`
  - `404` → `not-found`
  - anything else → `error`
- Endpoints (public `v1`/`v2` first, private `v1` as fallback):
  - **Me:** `/users/me`
  - **Memberships:** `/users/{uid}/courses?expand=course&limit=100`
  - **Term:** `/terms/{tid}`
  - **Instructors:** `/courses/{c}/users?role=Instructor&expand=user&limit=50`. Fallbacks: the same call without `expand`, then private memberships. Missing names are filled with `GET /users/{userId}?fields=name` (capped).
  - **Content:** `/courses/{c}/contents?limit=200` (paged)
  - **Gradebook columns:** `/courses/{c}/gradebook/columns` (`v2` → `v1`)
  - **My grades:** `/courses/{c}/gradebook/users/{uid}` (`v2` → `v1`)
  - **Calendar:** `/calendars/items` with no params first. The fallback is one valid 16-week ISO window. Items match courses by `calendarId`, and `start` is the due date.
- Auto-sync runs 2.5s after page load, throttled to at most once per 15 min (`force` bypasses the throttle). It also responds to `bbx:sync`.
- DOM fallback: if the API fails, it scrapes the Ultra course list (`source: blackboard-dom`).
- Each section has its own state: `ok | auth | forbidden | not-found | error`. A failed course still contributes calendar due dates.

### Pearson content script (`content/pearson.js`)
- Runs in all frames but only acts on a results page (`/Student/Results.aspx` etc.). The login page → `session-expired`, and the cache is kept.
- `BBX.parsePearsonResultsDocument` reads three parts of the page:
  - **Overall:** `#overallScore .score-value` + `#overall-score-details`
  - **Category table:** `OverallScoreGrid`
  - **Assignment table:** `table.table-inner-bordered`, rows `tr[id^=row]`. Cells are mapped by header label, not by position.
- Course identity comes from the footer `This course (CODE - NAME (YYYY_TERM_SUBJ_NUM_SECnnn))`. The record key is `section:<SECTION_ID>`.
- Per-assignment fields: `title`, `category`, `correctTotal` (+`correctTotalRaw`, `asterisk`/`note:'late'`/`footnote`), `scorePercent` (+`scoreRaw`), `status` (`graded|omitted|incomplete`), `timeSpent`, `dateStarted`, `dateWorked`, `incompleteIn`.
- Retries at 1.5s, 4s and 8s. Until the final retry, it waits for a complete page.
- States: `ok | parse-partial | parse-failed | session-expired | store-failed | error`.
- Parsing is strict: an incomplete assignment gets no percent, and a field that doesn't match its expected shape is dropped.

### Background service worker (`background.js`)
- It is the sole writer and uses a serialized write queue.
- Origin validation:
  - Blackboard snapshots are accepted only from `learn.uark.edu`.
  - Pearson records are accepted only from `*.pearson.com`.
  - prefs, sync and clear are accepted only from extension pages.
- `mergeBlackboard` and `mergePearsonRecord` keep good data when a refresh fails or comes back partial.
- The alarm `bbx-refresh` fires every 30 min and calls `pokeOpenTabs` (non-forced). It never opens tabs and never fetches anything itself.
- Messages: `storeBlackboard`, `storePearson`, `status`, `getStatus`, `requestSync` (forced), `clearCache`.
- `onInstalled` initializes only missing keys.

### Storage schema (`chrome.storage.local`)
- `bbx_blackboard`: `{ student, terms, courses[], _meta:{source,pulled_at} }`
- `bbx_pearson`: `{ records: { [key]: record } }`
- `bbx_status`: `{ blackboard:{state,lastSuccessAt,source,message}, pearson:{…} }`
- `bbx_prefs` (UI only): `{ layout, favorites[], pearsonMap{} }`
- **Course** fields: `id`, `code`, `title`, `content[]`, `gradebook`, `instructors`, due items, `verified`, `source`.
- Content types: `folder|module|link|document|generic`.
- `findOverallColumn` looks for these signals: primary `externalGrade`, a column named "Overall", `grading.type==='Calculated'`, a column named "Total". If the result is ambiguous, the overall grade shows as not synced.
- A course with empty columns and no grades is treated as Pearson-backed and shows "No grades posted in Blackboard".

### Dashboard UI (`dashboard.html`, `dashboard-ui/`, built `dashboard/assets/`, `popup/`)
- **Build:** Vite + React + TypeScript in `dashboard-ui/`. `npm run build` typechecks and writes static files to `dashboard/assets/` (`dashboard.js`, `dashboard.css`). `dashboard.html` loads `shared/normalize.js` (global `BBX`) and then that bundle. No dev server ships inside the extension. Light (cardinal `#9D2235` on `#F6F5F3`) is the default theme; System and Dark remain in the switch.
- **Files:** React views cover the same routes as the previous vanilla renderers. The bundle only reads `chrome.storage.local` (via `BBX.mergeForDashboard`). UI prefs are saved with `bbx:setPrefs` so the background worker stays the only writer. No external resources; all times are formatted in America/Chicago.
- **Routes:** `#/` Today (default), `#/courses`, `#/course/<id>/<content|gradebook|calendar>`, `#/grades` and `#/grades/<id>` (row pre-expanded), `#/calendar` (Agenda), `#/calendar/month[/YYYY-MM]`, `#/calendar/recent`, `#/activity` (same as Recent), `#/tools` (Diagnostics). `#/messages`, `#/institution`, `#/organizations` are stubs with an "Open … in Blackboard" button in the header; unknown routes show "Page not found".
- **Nav:** desktop/tablet rail (monogram, Search Ctrl/⌘ K, Today, Courses, Calendar, Grades; Diagnostics, the In Blackboard external links, the System/Light/Dark theme switch and the student name at the bottom). Phone: bottom bar (Today, Courses, Calendar, Grades, More); More opens a sheet with the rest. Stub pages highlight their rail item and the More tab. The profile row is hidden when no student name is synced.
- **Today:** KPI tiles (Past due, Due today, Next 7 days) that jump to their sections; Past due / Today / Next 7 days lists; "How you're doing" grade tiles (MyLab and Blackboard lanes, never combined) with one grade-band legend; "Unfinished MyLab work" (incomplete MyLab items, stamp in the section header, link at the bottom). Phone adds a compact text-only Grades strip under the KPIs whose header prints each source's read time.
- **Due rows:** one date chip component (month / day / weekday) used on Today rows, the agenda day rail, course side cards and the Month day panel. Today rows print the canonical "Thu, Oct 8 · 11:59 PM CT" plus a relative label; agenda rows print "11:59 PM CT" under a day rail that carries the date and relative day.
- **Calendar:** Agenda | Month | Recent switch plus a "Blackboard calendar" link. Agenda: Past due and Upcoming on the left, "Recently due · last 14 days" (expanded, Submitted / graded and other status chips visible) on the right, older items in a collapsed fold. Month: 7-column grid (chips wrap to 2 lines with a full `title`; dots on phone, past-due as a ring), a legend under the grid, and the selected day's list beside it (below on phone). Recent: Past due + Recently due + Older. Course Calendar tab: Upcoming first, past items (last 30 days) with their status beside it, older collapsed.
- **Courses:** list (columns: course, next due, MyLab, Blackboard, favourite) or grid (wrapping cards; the last row stretches). Next due shows a "N past due" / "N may be past due" line above the title, then "Tomorrow · Thu, Oct 8 · 11:59 PM CT". Each grade carries a printed stamp. One instructor label ("Instructor not yet synced") with the reason in a tooltip. The list/grid toggle is hidden on phone (both render as cards).
- **Course page:** breadcrumb topbar aligned to the content width, coloured hero with "Open in Blackboard", tab strip (Content, Gradebook, Calendar + link-out tabs) with a fade mask and a separate "more tabs" button when it overflows, `[` / `]` to cycle tabs. Content: item list (type shown by icon; screen-reader text names the type). An item is a link only when the synced record included an https Blackboard or Pearson address; otherwise it stays plain text. "Due in this course", faculty and "In Blackboard" side cards. Restricted courses show a flat state panel with "Checked <time>" and the course's due dates in the main column. Gradebook: full-width Overall card (MyLab and Blackboard lanes, a "Blackboard items" summary lane, "Shown side by side; never combined" when both sources exist, grade-band legend), MyLab card (matched-by line, category table, assignments table with a late-submission footnote), Blackboard gradebook table (Item, Due, Status incl. "Graded", band-tinted grade pill). Tables stack into compact row cards on phone.
- **Grades:** one row per course (MyLab | Blackboard | items synced), band legend once per page, expandable rows showing the MyLab category table + matched-by line and the Blackboard items table side by side (equal height).
- **Quick jump + shortcuts:** `/` or Ctrl/⌘ K opens a search over pages, courses, content, due items, gradebook and MyLab items. `g t` / `g c` / `g k` / `g g` go to Today / Courses / Calendar / Grades, `[` / `]` cycle course tabs, `?` shows the shortcuts overlay, Esc closes popovers.
- **Theme:** System / Light / Dark, saved in prefs (`theme`) and mirrored to localStorage to avoid a flash.
- **Freshness pill (one per page header):** desktop "Blackboard 7:23 PM · 8 min ago · MyLab 4:23 PM · 3 h ago" plus state words (sign-in expired, partly read, failed); phone "BB 8m · MyLab 3h" / "BB expired 3d". Its sheet lists each system's last success (full CT date-time), source, last attempt, detail, the blocks on this page with their read times, Sync now and a Diagnostics link.
- **Stamps and state chips:** every data block prints its source and read time ("BB · 7:23 PM", "BB · Oct 4, 7:23 PM"; lanes and table cells print just the time). Stale or failed blocks show a clock with the date ("◷ Oct 4"). Clicking a stamp shows the full CT time, age and notes. State chips/panels: Not synced yet, Partly read, Sign-in expired, Last read failed, Not shared with student accounts, Nothing posted, Lives in Blackboard.
- **Stale-data honesty:** when Blackboard data is stale (sign-in expired, last sync failed, or older than 24 h) KPI tiles are muted with "as of Oct 4"; items Blackboard last reported as due whose due time has since passed are shown as "Past due · status unknown since last sync (Oct 4)" (counted as "+N may be past due"), never as missing. Pearson parts carried forward from an earlier read are captioned "From earlier read · Oct 3"; when the latest MyLab read was partial, each table prints its read time.
- **Notices band:** Blackboard expired / failed / older than a day, MyLab expired / couldn't be read / partly read, merged into one line.
- **Diagnostics:** Sync status per system (state, Last success and Last attempt as "Oct 7, 2026, 7:23 PM CT (8 min ago)", source, message), Sync now / Clear cached data, and per-course section states (the shared source is stated once; phone hides empty cells).
- **Footer:** "Read-only … All times Central (CT)", Diagnostics, Shortcuts.
- **Prefs:** layout, favourites, Pearson→course mapping, theme.
- **Popup:** dashboard tokens in light and dark; state words ("Synced 8 min ago", "Sign-in expired · Showing data from 3 d ago", "Partly read"); Open dashboard and Sync now (`bbx:requestSync`); when Blackboard sign-in expired, "Sign in to Blackboard ↗" becomes the primary action.

### Known limitations
- It can't sync on its own. The 30-min alarm only pokes tabs that are already open and signed in.
- Some courses return `403` to the student API, so they can't be synced (the dashboard says so).
- Pearson's default "Past 2 Weeks" view limits which assignments get captured.
- The no-params calendar call may leave out older items.
- Pearson course identity depends on the footer text format staying the same.

## Part 2: Thinking lenses
- **Sync without babysitting tabs:** a pinned tab, an offscreen document, a user-triggered "sync all" that opens and closes tabs, or alarms that need a live tab. Compare each one's cost in permissions, reliability, and the "no surprises" feel.
- **Coverage vs. honesty:** capture the full Pearson list and older calendar items without guessing, and show partial coverage truthfully.
- **Markup-drift resilience:** harden the parsers, and have Diagnostics show what could and couldn't be read, so breakage is loud.
- **The UI I actually want:** a unified "what's due" view, a real grades overview, keyboard navigation, and density, with every number still traceable.
- **Trust surface:** per-field source + timestamp, shown without clutter.
- **Correctness tests:** tests that catch parser, overall-grade and Pearson-match regressions, built from owner-approved real captures kept outside this repo (see `PROTOCOL.md`).
- **Scope and permissions hygiene:** the minimum footprint per feature, and when a feature isn't worth the surface.
