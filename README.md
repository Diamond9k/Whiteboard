# Mirror

A personal, read-only dashboard for one University of Arkansas student’s Blackboard (`learn.uark.edu`) and Pearson MyLab courses. It is a Next.js app. It is not affiliated with the University of Arkansas, Anthology, or Pearson.

Dark mode is the default.

## Why it does not sync by itself

A Chrome content script can read the signed-in Blackboard and MyLab pages because it runs inside those origins. A normal web app cannot. Cookies are not sent cross-origin, and this app does not ask for them.

So the dashboard never fetches Blackboard or MyLab. It renders a snapshot that already lives in this browser.

```
signed-in Blackboard tab ── console collector (GET only) ── blackboard-capture.json ─┐
signed-in MyLab Results ── console collector (page read) ── mylab-*.json ────────────┼─▶ Import ─▶ lib/cache.ts ─▶ localStorage
                                                                                      │
fixtures/sample.json ── dev only, labeled SAMPLE DATA, never written to the cache ───┘
```

`lib/cache.ts` is the **single writer** of academic data. The only key is `mirror.snapshot.v1`. Every other module reads. UI preferences (theme, list layout, favorites) use a different key in `lib/prefs.ts` and are not academic data.

## What the dev screen is

`next dev` with an empty cache shows `fixtures/sample.json`, behind a **SAMPLE DATA** banner.

That fixture contains only what was stated for Fall 2026:

| Course | What is in the fixture |
|---|---|
| COM 1003-901 | Code, described as a phone/basic communication course. Official title is absent. |
| ECON 2103-901 | Code, title Principles of Macroeconomics. Grades live in MyLab. No scores. |
| MATH 20503-019 | Code, title Finite Mathematics. Grades live in MyLab. No scores. |
| PLSC 20003-903 | Code, title American National Government. Not open yet. |

There are no invented grades, due dates, assignment titles, instructor names, or links. Those fields say they are not synced. A production build (`next start`) does not show the fixture. With an empty cache it says nothing is synced.

## Run it

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run build` then `npm start` runs the production server.

## Load your real MyLab and Blackboard data

MyLab is the gradebook. Blackboard adds content, faculty, and due dates when its API returns them.

1. Run the dashboard and open **Import**.
2. Sign in at [https://learn.uark.edu](https://learn.uark.edu). Open DevTools (Console). Open [http://localhost:3000/collector/blackboard.js](http://localhost:3000/collector/blackboard.js), copy the whole file, paste it into the Blackboard console, and press Return. It downloads `blackboard-capture.json`. Every request is `GET`.
3. For each MyLab class, open the **Results / gradebook** page while signed in (`…/Student/Results.aspx`). If the gradebook is inside an iframe, select that frame in DevTools. Paste [pearson.js](public/collector/pearson.js) the same way. It does not call `fetch`. It copies the tables that are on the page and downloads `mylab-<section>.json`.
4. On **Import**, choose those files (or paste one JSON blob) and press **Save in this browser**. The sample roster is not merged in. Saving goes through `writeSnapshot` once.

Run the MyLab collector once per class. Re-importing the same class keeps any section the newer page did not include, and marks it as an earlier read.

The Results page often defaults to a short date range such as Past 2 Weeks. The collector will not change that control, because changing it can submit a form. Change the range yourself, then run the collector again. If the page shows the range, the snapshot stores that label.

### What each collector reads

Blackboard, public API first, then the private Ultra paths the old extension used:

- `/learn/api/public/v1/users/me` (then `/learn/api/v1/users/me`)
- memberships with the course expanded
- terms, instructors, top-level content, and one extra level of folder children (capped)
- gradebook columns and your gradebook row
- calendar items, no parameters first, then one 16-week window

A link is stored only when the response or the page contained an `https` URL on `learn.uark.edu` or `*.pearson.com`. Anything else is dropped. Items with no link stay disabled.

MyLab, from the Results document only:

- overall score and the details sentence
- category rows (average, weight, points, time)
- assignment rows, mapped by the header labels: title, category, correct/total, score, time, date started, date worked, and any real link in the row
- the footer line `This course (… (YEAR_TERM_SUBJ_NUMBER_SECnnn))`

If two overall percents disagree, both are kept and neither is chosen. An incomplete row never gets a percent. A field that does not match its expected shape is omitted.

MyLab records attach to a Blackboard course by section id, then by course code, then by a keyword only when exactly one current course matches. The gradebook says which rule matched. A MyLab record with no Blackboard course still becomes its own course.

## Routes

Today, Courses, Calendar (agenda, month, recent), Grades, each course’s Content, Gradebook, and Calendar, plus Announcements, Discussions, Messages, and Groups. Those last four are not collected. The pages say so. They do not invent posts.

Diagnostics shows each system’s last read and can clear the local snapshot or export it. Clearing does not touch Blackboard or MyLab.

## Schema

`lib/schema.ts` is the source of truth (`schemaVersion: 1`): courses, MyLab gradebook (categories, weights, assignments, links), Blackboard content and gradebook, due items, and a stamp (`source` + timestamp) on each record. Sources are `pearson`, `blackboard-api`, `blackboard-dom`, and `student-stated`.

## Limits

- Nothing syncs in the background. You run the collector when you want a new snapshot.
- Some Blackboard sections return 403 to a student. The course still appears, and that section says it is not shared.
- Pearson markup can change. A miss becomes “couldn’t be read”, not a guessed number.
- The no-parameter calendar call can omit older items.
- Course identity on MyLab depends on the footer sentence staying in the same shape.
