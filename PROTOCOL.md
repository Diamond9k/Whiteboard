# Whiteboard protocol: nothing made up

This repo holds whiteboard (design) work for the UARK Blackboard Dashboard. It is public. One rule governs everything in it.

## Rule 0: nothing in this repo is made up

Every value, name, date, grade, id, screenshot or example in this repo is either
1. **real**: read from a real source, and labelled with that source and the time it was read, or
2. **absent**.

There is no third option.

## What that forbids
- Fixture, mock, sample, seed, demo or placeholder data, in any file and in any form.
- Example values in comments or docs. Formats are described in words or as patterns, never with instances.
- Screenshots or recordings rendered from invented data.
- Generated "realistic" text, names, numbers or images presented as content.
- Filling a gap with a plausible value. Anything that can't be read shows "not yet synced", "couldn't be read" or "—".

## Personal data
Real data about a person (grades, names, enrolment, section ids, student ids) does not go in this repo while it is public. It is **removed, not replaced**. A redacted spot is described in words. It is never swapped for a made-up stand-in.

## What is allowed
Authored design and code: layout, colours, type, copy, icons, logic and tests that check behaviour without inventing data. A test's input is either a real, owner-approved capture stored outside this repo, or a structural check that needs no data values.

## Design previews
The dashboard renders only from real cached data in the browser extension's storage. Any local preview harness that feeds data in lives **outside** this repo and is never committed. That includes this project's earlier fake-fixture preview, which is excluded.

## Before every commit
1. Run `pwsh ./scripts/protocol-check.ps1`. It must print `PROTOCOL OK`.
2. The check fails on: committed fixture, mock or sample files; preview harnesses; image files outside `icons/`; and the personal-data patterns listed in the script.
3. If the check flags something, remove it. Never edit the check to make a commit pass without the owner's yes.

## Changes to this protocol
Only the repo owner (Diamond9k) changes this file.
