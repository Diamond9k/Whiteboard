# UARK Blackboard Dashboard: personal Chrome extension (MV3, unpacked)

This is a personal, **read-only** redesign of University of Arkansas Blackboard Ultra
(learn.uark.edu), with grades for Pearson-backed courses pulled from Pearson MyLab. It uses **your own
signed-in browser session** and shows only data it actually pulled. It contains
no sample data. When nothing has been pulled yet, every view says **"Not yet synced"**.

> Unofficial. It is not affiliated with the University of Arkansas, Anthology/Blackboard or Pearson.
> It relies on undocumented behaviour that can change at any time (see *Caveats*).

## Load it (unpacked)

1. Copy this folder to a permanent location on your computer.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder (the one containing `manifest.json`).
4. Open <https://learn.uark.edu/ultra/course> and sign in. About 3 s after the page loads, the
   extension syncs courses, faculty, top-level content, the gradebook and due dates.
5. For courses that use Pearson MyLab, open Pearson MyLab while signed in and go to the **Results / Gradebook**
   page (`…/Student/Results.aspx`). The extension reads the overall score, category breakdown and items.
6. Open a new tab (the dashboard replaces the New Tab page) or click the toolbar icon and choose
   **Open dashboard**.

If you don't want the New Tab override, delete the `chrome_url_overrides` block from
`manifest.json` and reload the extension. You can still reach the dashboard from the popup.

## Build the dashboard

The extension ships a static React bundle. From `dashboard-ui/`:

```
npm install
npm run build
```

That typechecks and writes `dashboard/assets/dashboard.js` and `dashboard/assets/dashboard.css`.
`dashboard.html` loads `shared/normalize.js` first (so `globalThis.BBX` exists), then the bundle.
Reload the unpacked extension after a rebuild. `npm run dev` serves the same UI for layout work;
outside the extension, chrome.storage is missing and every view says nothing is synced.

## Files

| Path | Role |
|---|---|
| `manifest.json` | MV3 manifest. Permissions: `storage`, `alarms`. Hosts: `learn.uark.edu`, `mylab.pearson.com`, `*.pearson.com` |
| `background.js` | Service worker. It is the **only writer** to `chrome.storage.local` and serializes writes. It checks the sender origin of every data message, merges new data without losing good cached data, and runs a 30-min alarm that asks *already-open* BB/Pearson tabs to refresh |
| `shared/normalize.js` | Shared normalization module (`globalThis.BBX`), loaded by the content scripts, the worker, the dashboard and the popup. It turns raw API/DOM data into the `blackboard-mirror/data/courses.json` shape, adding provenance |
| `content/blackboard.js` | Content script on learn.uark.edu. Calls the REST API (GET only, `credentials:'include'`) and falls back to scraping the DOM |
| `content/pearson.js` | Content script on Pearson pages (all frames). Parses `Student/Results.aspx` with the real selectors (`BBX.parsePearsonResultsDocument`) |
| `dashboard.html`, `dashboard/assets/` | New-tab dashboard. React UI built to static files (see below). Reads `chrome.storage.local` through `BBX.mergeForDashboard`. Light theme is the default |
| `dashboard-ui/` | Vite + React + TypeScript source for that dashboard. `npm run build` writes `dashboard/assets/dashboard.js` and `dashboard.css` |
| `popup/` | Toolbar popup showing sync status per system, with Open dashboard and Sync now buttons |

## Data flow

```
learn.uark.edu tab ──content/blackboard.js──┐  (GET /learn/api/…, your session cookies)
                                            ├─ chrome.runtime.sendMessage ─▶ background.js ─▶ chrome.storage.local
mylab.pearson.com tab ──content/pearson.js──┘  (reads the visible Results page)       │  (origin-checked, merged)
                                                                                       ▼
                         dashboard.html / popup ◀── BBX.mergeForDashboard() ◀── storage.onChanged
```

Storage keys:
- `bbx_blackboard` holds the normalized Blackboard snapshot.
- `bbx_pearson` holds `{records:{[key]:…}}`.
- `bbx_status` holds per-system state, last success, source and message.
- `bbx_prefs` holds UI prefs only: layout, favourites, and manual Pearson→course mapping.

### Blackboard endpoints (tried in order; the first that works wins)
| Data | Endpoints |
|---|---|
| Me | `/learn/api/public/v1/users/me`, then private `/learn/api/v1/users/me`. Display name = `name.given + ' ' + name.family`. `name.preferredDisplayName` is a display-setting enum (its value is literally `"GivenName"`), not a name, and is never read |
| Memberships | `/learn/api/public/v1/users/{id}/courses?expand=course`, then `/learn/api/v1/users/{id}/memberships?expand=course` |
| Terms | `/learn/api/public/v1/terms/{termId}` (used for term grouping and "current" detection) |
| Faculty | `/learn/api/public/v1/courses/{id}/users?role=Instructor&expand=user`, then the same call without `expand`, then private memberships. Without `expand=user` the entries carry only `userId`. Any instructor entry still missing `user.name.given/family` gets one `GET /learn/api/public/v1/users/{userId}?fields=name` (max 6 per course). Entries with no obtainable name show "Instructor not yet synced". A 403 also shows "not yet synced" |
| Content | `/learn/api/public/v1/courses/{id}/contents` (top level only) |
| Gradebook | `/learn/api/public/v2/…/gradebook/columns` (falls back to v1), plus `…/gradebook/users/{userId}`. **Overall grade**: the column scored highest on `externalGrade === true` (+4), name/`columnName` contains "Overall" (+3), `grading.type === 'Calculated'` (+2), and name contains "Total" (+1). Its value is the grade entry whose `columnId` matches, read from `displayGrade.text` / `displayGrade.score` / `score`. A top-score tie without `externalGrade` counts as ambiguous. If there's no such column or the tie is ambiguous, the overall grade is "not yet synced". Items are never summed. If **both** arrays come back empty (Pearson-backed courses), the view shows "No grades posted in Blackboard" |
| Due dates | gradebook column `grading.due`, plus `/learn/api/public/v1/calendars/items` called with **no params** (verified 200 live). Fallback: one valid ISO-8601 UTC window of 2 weeks back to 14 weeks ahead. The old `since/until` window was 14 d + ~16 weeks, over the API's 16-week limit, and returned 400. Items map to courses by `calendarId` (= course id). `start` is the due datetime in UTC, shown in America/Chicago. `title` is the event title and `dynamicCalendarItemProps.eventType` its kind. Items without a valid `start` are skipped. A `GradebookColumn` item whose `id` equals a fetched column id is linked to that column's grade record and not duplicated. Calendar due dates also show for courses that weren't detail-fetched |

Details are only fetched for current/upcoming-term, available courses (max 15). Past-term courses
are listed behind a "Show past terms" toggle.

**DOM fallback.** This runs only if the API fails for a non-auth reason while you're on the Ultra
course list. It scrapes course cards (id, title, course id, instructor) and marks them
`source: 'blackboard-dom'`. A DOM scrape never overwrites richer API data; it only adds courses the
API didn't return.

### Pearson
On a Results/Gradebook page, `pearson.js` retries at 1.5 s, 4 s and 8 s, because MyLab renders late. It stores early only when all three parts below are found. Otherwise it stores whatever was found on the last try. The selectors come from the live `mylab.pearson.com/Student/Results.aspx` page and live in `BBX.PEARSON_SEL` / `parsePearsonResultsDocument()` in `shared/normalize.js`:
- **Overall**: `#overallScore .score-value` (a percent). The text in `#overall-score-details p` ("You have earned X out of Y points for a Overall Score of Z%.") supplies earned/total points. If the two percents disagree, both are kept and neither is picked.
- **Categories**: `#ctl00_ctl00_InsideForm_MasterContent_OverallScoreGrid` / `table.table-overall-score`, rows `tbody tr`. The name comes from `th[scope=row]` with its icon removed. Then the cells, in order: Average Score (`NN.NN %`), Category Weight (`N pts`), Points Earned (`N pts`), Time Spent. The `tfoot` row is the Total. Values are stored verbatim after a format check, and a cell that fails its check is left out. The page has **no** "N of M submitted" counts, so none are shown.
- **Assignments**: `table.table-inner-bordered`, rows `tbody tr[id^=row]`. Live header order: Assignment | Review | Correct/Total | Score | Time Spent | Date Started | Date Worked. Cells are mapped **by header label** (`thead th`, lower-cased, matched by "contains", colspan-aware), not by position; if no usable header is found, a positional fallback over the `td`s is used (a leading Review cell is skipped when there are 6+ `td`s). The name comes from `th.leftcol` with the icon and hidden `span.readableButHidden` removed; that hidden span becomes the item's category. Per row: `correctTotal` (the first `a/b` fraction in the cell, two numbers separated by `/`, possibly decimal and possibly followed by a `*` — `<sup>` footnotes are removed before extraction and dates never match; a `*`, footnote marker or `<sup>` sets `asterisk: true`, `note: 'late'` (plus `footnote: true` for a non-`*` footnote), the raw cell text is kept in `correctTotalRaw`), `scorePercent` (number from a `NN.NN%` in the Score cell, else `null`), `status` (`incomplete` when ANY cell of the row except the assignment name says "incomplete" (case-insensitive, whole word; on the live page it sits around the Time Spent column, not in Score) — `incompleteIn` records which column it was found in; `omitted` when it says "(omitted)" or the row has class `omit`; `graded` when a percent or count was read; otherwise left out), `timeSpent` (hours/minutes text), `dateStarted` / `dateWorked` (an `MM/DD/YY` date and a time on two visual lines are joined with a space via `innerText` in the browser or a child-node join, plus a regex fix for a date glued directly to its time). Every field must pass its own format check or it is left out; nothing is moved into another column, and incomplete rows never get a percent. Records carry `itemsSchema: 2`; assignment lists cached by older versions (which misread Correct/Total as the Score) are not displayed or carried forward.
- Records are tagged `source: 'pearson'` + `syncedAt`. If a part is missing, status becomes `parse-partial`, the dashboard shows the "couldn't be read" banner, and that part says "couldn't be read". If a previously read part is missing from a newer parse, the cached value is kept and marked as cached (`staleParts`). If nothing is found, nothing is stored and the status is `parse-failed`.
- Manifest coverage: the Pearson content script matches `https://mylab.pearson.com/*` and `https://*.pearson.com/*`, which already includes `/Student/Results.aspx`. No other hosts were added. Some courses may run MyLab on a different Pearson host. That host is **not confirmed** for UARK, so it isn't in the manifest. If your Results page opens on another host, add that exact host to `host_permissions`, the Pearson `content_scripts.matches`, `PEARSON_TAB_PATTERNS` in `background.js` and `fromPearson()`.

**Matching to a course.** Your manual mapping comes first. Next is a course code in the Pearson course
title (subject letters plus course number). Last is a keyword (`econ/macro/micro`, `math/finite/…`) that matches exactly **one**
current course. If the match is ambiguous, the record is listed under *Grades → Pearson results not matched
to a course*, with a dropdown to assign it. The dashboard always shows *why* a record was attached.

## Defensive / no-hallucination rules (how they're enforced)

- **Only pulled data renders.** The normalizer omits anything missing. Views render missing
  fields and sections as "Not yet synced", with the reason (forbidden, endpoint missing, session expired, never fetched).
  Content progress isn't exposed by the public API, so it shows a dashed "progress not synced" ring
  instead of "not started". Unknown course availability shows "Availability not yet synced",
  and the course is never shown as locked unless Blackboard said it was unavailable.
- **Provenance everywhere.** Each course, section, list item and Pearson record carries `source`
  (`blackboard-api` | `blackboard-dom` | `pearson`) and `syncedAt`. Every view shows "synced from X · time (ago)".
  When a refresh failed and older data is shown, that data is tagged "cached — last refresh failed".
- **Session expired.** A 401, a login redirect, or an HTML login page served as 200 on *all* candidate
  endpoints sets `session-expired`. The cache is kept, and the dashboard shows "Blackboard session expired —
  showing cached data. Open Blackboard to refresh" with a link. Pearson sign-in pages work the same way.
- **Never lose good data to a bad pull.** Failed sections keep the previous good value (marked stale).
  A pull with zero courses keeps the cache. A Pearson parse that finds nothing stores nothing and reports
  `parse-failed`.
- **try/catch everywhere.** Every fetch has a 15 s timeout, and paging is capped. Every parse and message is wrapped.
  A failure becomes a section state, never a guessed value.
- **Derived values are mechanical only.** These are:
  - the course code parsed from the real course id (`YEAR_TERM_SUBJ_NUMBER_SECnnn` → `SUBJ NUMBER-nnn`)
  - `score / possible` strings built from real numbers
  - a presentational colour hashed from the course id
  - due status computed from a real due date plus the real grade record:
    - `overdue` is only shown as "Past due · no submission recorded in Blackboard", and only when the grade records were actually fetched
    - otherwise it is just "due date passed"
- **Read-only.** `getJSON()` hard-codes `method: 'GET'`. Nothing clicks, posts or submits. The Pearson script makes no requests at all.
- **XSS / link safety.** All data is HTML-escaped. Hrefs are restricted to `https://learn.uark.edu` and `https://*.pearson.com`.
  Pearson page URLs are stored without their query string.
- **Minimal permissions.** No `<all_urls>`, no `tabs`, no `cookies`, no `scripting`. Tab URL filtering for the
  alarm and "Sync now" works through host permissions. The background never opens tabs and never fetches on its own.

## Dev notes

- **Empty state.** With empty storage, every page shows the "Not yet synced" onboarding card. Opening
  `dashboard.html` outside the extension (no `chrome.storage`) shows the same empty state with a dev note.
  Sample data is never shown.
- **Diagnostics** (left nav) shows per-system state, last success, source and error message,
  per-course section states, **Sync now** and **Clear cached data** (local storage only).
- Validate:
  ```bash
  python3 -m json.tool manifest.json >/dev/null && echo manifest OK
  for f in background.js shared/normalize.js content/*.js popup/popup.js; do node --check "$f"; done
  for f in dashboard/app.js dashboard/js/*.js; do node --input-type=module --check < "$f"; done
  ```
- Debug logs: open DevTools on a learn.uark.edu tab and filter for `[BBX`. For the worker, use
  `chrome://extensions` → *service worker* → Inspect.

## Caveats / risks

- **Unofficial Blackboard API use.** The public REST API normally expects an OAuth app token.
  Calling it with session cookies may return 401/403 at UARK. The script then tries the private
  `/learn/api/v1/…` endpoints the Ultra UI uses, which are undocumented and can change without notice.
  Only `users/me`, memberships and terms have private fallbacks. Content, gradebook and calendar use public
  endpoints only, so if those reject cookie auth they will show "not yet synced" until private equivalents are added.
  Instructor lists are often hidden from students (403).
- **Deep links.** Course tab URLs (`/ultra/courses/{id}/grades`, `/announcements`, …) follow Ultra's
  scheme but weren't verified against UARK. If one 404s, the course outline link always works.
- **Pearson selectors can drift.** The parser uses the real Results.aspx ids/classes and cell order (see *Pearson* above). If Pearson
  changes its markup, you'll see `parse-failed` / `parse-partial` (cached data kept) rather than wrong numbers.
  Pearson dates (started/worked) are kept verbatim as text and are not used for due-date logic.
  The Pearson course title selector hasn't been confirmed on Results.aspx. If the URL has no course id and
  no title is found, nothing is stored. Known limitation: if two Pearson courses have no course id in the URL
  and the same generic page title, they share one record key, and the last Results page opened overwrites the other.
- **Sync needs an open tab.** Data refreshes only while a signed-in Blackboard/Pearson tab is open:
  on page load (throttled to once per 15 min), on **Sync now**, or on the 30-min alarm.
- **Terms of use.** This automates reads of your own data through your own session. Check UARK's and
  Pearson's acceptable-use policies. Keep the request volume low (it already is: roughly 4 requests per current course per sync).
- **Local data.** Grades are stored unencrypted in this Chrome profile's extension storage.
  Use **Clear cached data** or remove the extension to delete it.
