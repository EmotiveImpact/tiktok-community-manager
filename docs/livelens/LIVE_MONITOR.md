# LiveLens LIVE monitor

The default console opens **Live monitor**. Start with an account or configured
source, choose a bounded check/watch or recording, then reopen the retained video
and captured conversation. **Review desk** is a separate destination for findings
and protection signals. Investigations and reports remain available. Existing
community/CRM tools run in native Electron; their browser `?page=` bridge is a
development demonstration, not a shared-server CRM.

## Choose and check a source

Workspace administrators with source-management permission can enter `@account` and select
**Add account**. This saves a public TikTok source; it starts no collection.
**Manage sources & schedules** also exposes configured permitted HTTPS media and
explicitly labelled generated-file fixtures. Source credentials and signed media
URLs stay on the service.

Select a watchlist row to work with that source. **Check LIVE** for TikTok, or
**Check source** for other adapters, creates a discovery-only schedule ending
within 15 seconds, with a 10-second polling interval and recording off. It is a
short bounded watch, not an instantaneous API peek. **Watch only** uses the
chosen watch window, initially five minutes, and still records no video.

Statuses come from receipts: Unchecked, Checking, Check failed, or availability
**at last check**, with the check time. An earlier LIVE observation does not say
the account is LIVE now. A failed check does not establish that it is offline.
Adding a source or opening the console never silently starts a watch.

## Record and stop

**Recording limit (seconds)** starts at 16 and accepts whole seconds from 2 to
3,600. **Watch window (minutes)** starts at five and is bounded to 24 hours.
The monitor requests two-second media segments. Service quotas and configured
recorder concurrency also apply; the default worker has two slots.

- **Record now** applies to a configured source with an existing retained session,
  such as a generated fixture. It requests one explicit job with the selected
  recording limit.
- **Record when LIVE** applies to a discovery source without a fixed session. It
  creates a bounded watch with recording enabled. Each discovered broadcast gets
  a separate retained session and a job bounded by both the recording limit and
  remaining watch time. It does not mean recording started successfully.
- **Stop recording** requests a stop for that job. Saved verified segments remain
  replayable; finalisation and any failure are shown in the receipt.
- **Stop watch** stops the schedule and requests a stop for its current
  watch-created capture. A separately requested job has its own stop control and
  duration limit. The schedule also stops its current capture when its window or
  polling budget ends.

Starting, queued, recording, stopping, completed and failed states are service
states. Recording is presented as active only after media has been retained.
Errors and partial captures remain visible; a process running is insufficient
evidence of a saved recording. A viewer can inspect permitted records but cannot
check, watch, add sources or start/stop jobs.

## Preview and reopen

**Recording preview** plays actual verified saved segments, so it is delayed.
There is no direct live-video preview implemented by this screen. Checking a
source alone creates no playable video. Missing or damaged media refuses replay;
previously saved verified segments can remain available after an interruption.

The adjacent feed contains that retained session's actual chat, source captions,
independent transcripts and gap records. **Chat**, **Transcript** and
**All events** filter those records. Captions remain distinct from independent
speech. Unknown attribution stays unknown; an account assertion is not automatic
speaker identification. A displayed source clock remains separate from collector
and receipt clocks. Select a statement to seek covered media, then use
**Open original context** to inspect its exact evidence and surrounding records.
**Open conversation** provides the full retained workspace.

The feed retains the latest 100 loaded events and advances its journal cursor
as active capture/watch receipts refresh. **Load newer events** advances another
bounded page when one is available; **Open full conversation** reopens the
retained history. It does not claim that the entire journal is loaded.

**Active recordings** shows job state, saved duration/bytes, stop requests and
errors. **Recent recordings** includes up to eight returned jobs with saved
segments, including interrupted jobs. Select one to replay that job, without
continuing into another recording from the same session. **All capture receipts**
opens source/job management. The monitor merges the recent 100 receipts with a
separate page of up to 200 active jobs, deduplicated by job ID. Older active jobs
therefore retain their Stop controls even when they fall outside the recent page.
The recorder's maximum configured outstanding-job bound is 100 per workspace;
the active page covers that bound. Recent lists describe the returned selection,
not every historical capture.

## Configuration and measured boundaries

Use [RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md) to configure the private
same-origin console, recorder, selected sources and optional speech engines.
[The service catalogue](../../services/intelligence/README.md) documents scopes
and request envelopes. Source checks and capture require configured workers and
the caller's recording-write authority; source creation additionally requires
workspace administration.

After the [documented install/build](FULL_APPLICATION.md#reproduce), run
`npm run console:fixture` for the local demonstration. Its loopback login is
`fixture` / `fixture-operator-only`. Generated colour bars, tone and fictional
chat are labelled fixtures. They are useful for replay, stop and restart checks;
they do not establish real TikTok access. Real selected permitted external LIVE
discovery/recording remains unvalidated. Provider access, signing terms and a
usable source are still necessary. Native Electron startup, representative
customer capacity and broad speech/semantic quality have separate gates.

Actual optional ALFRED tools are implemented and fixture-tested in
[draft PR #20](https://github.com/EmotiveImpact/Alfred/pull/20); see
[ALFRED_INTEGRATION.md](ALFRED_INTEGRATION.md) for the exact revision, private
installation and HTTP/CLI receipts. That branch remains unmerged/undeployed.
The standalone gateway does not infer another host's private registration.
Source-read, collection-control and model-egress grants stay separate. No
captured text becomes accepted agent memory automatically.

## Source-pattern attribution

The capture-first hierarchy follows inspected pinned recorder/monitor patterns:

| Reference | Inspected source and useful pattern | Adoption boundary |
|---|---|---|
| [XploitVoid/tiktok-live-recorder](https://github.com/XploitVoid/tiktok-live-recorder/tree/148c1d91b091be7052367480104f032d751d6068) | `client/src/pages/HomePage.tsx`: account check, watchlist, active jobs and saved recordings; `lib/watcher.js`: status checks and explicit auto-record; `lib/recorder.js`: FFmpeg start/stop, concurrency and chat sidecars; `server.js`: replay and job routes. | MIT root licence. Used as a design/lifecycle reference, not copied or installed as the LiveLens runtime. LiveLens uses its own workspace-bound durable jobs and verified media. Xploit's direct stream player is not claimed as implemented here. |
| [PieterVanBoheemen/tiktoklive_monitor](https://github.com/PieterVanBoheemen/tiktoklive_monitor/tree/51aba4d5dfcdda190db1827000487d6f28661e04) | `monitor/stream_monitor.py`: selected-account polling, stability, concurrency, status and graceful stop; `recording/stream_recorder.py`: recording state, disconnect confirmation and finalisation. | Design reference only. Its README claims MIT, but no repository licence file was found at this pin; no source transplantation or runtime adoption is claimed. |

The source files were read at those exact commits without running upstream
scripts. The previously audited server/recorder/monitor Git blob hashes match
[upstream-lock.json](../../research/upstream-lock.json). All eight research
Gitlinks remain unchanged and research-only; actual runtime choices and retained
licences are recorded in [REUSE_REGISTER.md](../../research/REUSE_REGISTER.md).
Source inspection does not establish that either upstream application works.

The isolated browser acceptance command is:

```sh
PYTHONDONTWRITEBYTECODE=1 LIVELENS_FFMPEG_PATH=/usr/bin/ffmpeg python3 scripts/validation/live_monitor_smoke.py
```

It requires the built application, Playwright and Chromium. It uses generated
media and labelled fictional accounts/evidence, stops its temporary services,
and verifies capture/replay/control boundaries. See [VALIDATION.md](VALIDATION.md)
for executed results; the command itself is not a provider-access receipt.
