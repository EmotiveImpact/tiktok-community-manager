# LiveLens review desk

The review desk places retained evidence, protection signals and draft
findings beside their original source context. The owner selected the Mission
Inbox structure and requested a restrained dark interface without neon accents.

It is now a secondary workflow. The owner's later direction makes the
[LIVE monitor](LIVE_MONITOR.md) the default entry point, with account selection,
capture controls and a large recording/chat workspace. The prior desk checks
below remain functional receipts; they do not establish final design acceptance.

The desk uses existing authenticated workspace routes. It loads at most 100
recent evidence records, 100 protection signals and drafts from six accessible
investigations, with a maximum of 200 visible items. Counts describe the loaded
selection. Category ordering helps navigation; it is not a risk score. Ordinary
evidence has no invented unread or reviewed state. Only pending protection
signals and draft findings enter the Needs review filter.

Selecting a record keeps the desk open and fetches its exact source and nearby
records. Supporting and conflicting statements remain independently selectable.
Original quotes, scoped anonymous speech tracks, clocks and integrity provenance
stay separate from operator or model interpretations. Verified media replay is
read-only on the desk; recording and archive controls remain in their existing
screens. Capture gaps and unavailable media are shown explicitly.

An investigation action opens the correct case and preserves its identifier in
the URL for reload. Signal acknowledgement uses the real scoped review endpoint
and preserves review history. Source schedules display returned states and last
observed provider status without implying a currently accessible LIVE. The phone
layout provides a focused source preview and a Back to inbox action; filters
support keyboard navigation.

The charcoal/slate tokens apply to the LiveLens console and its advanced screens.
The existing community/CRM theme is preserved. The owner deferred Pinterest
research after this cloud's network policy blocked it; no Pinterest references
were viewed. The selected muted C reference remains the visual direction.

Validation commands:

```sh
npm test
npm run build
PYTHONDONTWRITEBYTECODE=1 LIVELENS_FFMPEG_PATH=/usr/bin/ffmpeg python3 scripts/validation/review_desk_smoke.py
PYTHONDONTWRITEBYTECODE=1 LIVELENS_FFMPEG_PATH=/usr/bin/ffmpeg python3 scripts/validation/full_app_smoke.py
PYTHONDONTWRITEBYTECODE=1 LIVELENS_FFMPEG_PATH=/usr/bin/ffmpeg python3 scripts/validation/browser_smoke.py
```

Browser scripts require Playwright and Chromium; the full application script
also exercises offline PDF rendering. Local recordings and synthetic source
records remain explicitly labelled fixtures, not provider-access validation.

The application tests, renderer/Electron build and original/full browser journeys
passed with the updated console. The dedicated desk journey verifies exact
support/counterevidence selection, actual playback and seek, investigation deep
links and reload, persisted acknowledgement history, bounded schedules, phone and
keyboard selection, restart and a separate read-only server's scope/write
boundaries. See [SCREENSHOTS.md](SCREENSHOTS.md) for actual running UI and
[design QA](../../design-qa.md) for the selected-reference comparison.

The acceptance run also exposed and fixed a recorder deadline race. The private
FFmpeg quit command finalises media at the bound without accepting nonzero exits
as success. Thirty-one affected backend tests and the abrupt recording recovery
demo passed, including stalled and unsolicited interruption failures.
