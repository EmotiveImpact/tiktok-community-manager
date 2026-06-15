# Changelog

## 2.1.x — CRM flow polish
- **2.1.2** — Retired the legacy fan-detail drawer (the Leaderboard now opens the universal peek like everywhere else); fixed command-palette + tooltip label drift. The peek is now the single fan-detail surface app-wide. QA sweep: all flows verified.
- **2.1.1** — The full layout is now the default window state (window 1320×860, minWidth 1180). No more "cramped vs wide" — the complete layout (4 stat cards, top-supporter spotlight, 3-column profile) shows at the normal size without dragging.
- **2.1.0** — One **Reach out** model across the Reminders page and the Messages follow-up rail (same data, same actions). Sidebar renamed "Reach out".

## 2.0.x — The B+C hybrid CRM redesign
- **2.0.2** — Official TikTok note mark in the sidebar (replaced the hand-drawn SVG).
- **2.0.1** — Merged "command-center" dashboard: restored the stat cards, after-LIVE hero, recent sessions, and top-supporter spotlight alongside the new people-queues.
- **2.0.0** — Redesigned the whole CRM around the researched B+C hybrid: a **universal Fan Peek drawer** (glance at any fan from any page), **global ⌘K** fan search (Enter→peek, ⌘Enter→profile), a **people-queue Dashboard hub** ("who needs you today"), and the peek wired into every CRM list.

## 1.x — Foundations of the CRM
- **1.9.0** — Consolidated notes into one canonical model: a pinned **About** + a dated notes log in the timeline. Migrated the old `notesStore` island (no note lost), killed the silently-dropped `streamNotes`, made notes prominent.
- **1.8.x** — Persistent background audio + a now-playing mini-player; stream defaults to mobile view with an EulerStream upgrade prompt for HD video; fixed the infinite reconnect loop on offline/private LIVEs.
- **1.7.x** — Adopted a clean Radix UI system (Tabs/Tooltip/Select/Switch) across the whole app; fixed the O(N²) Followers load (~440× faster on 683 fans) by batching the strength computation.
- **1.6.0** — Unified the live Fan-Memory notes with the timeline; one definition of "cold"; Radix Dialog/Menu primitives.
- **1.5.0** — The real fan CRM: 360° profiles, activity timeline, relationship-strength engine, segments.
- **1.4.0** — "This is my account" mode + native go-live desktop notifications.
- **1.3.0** — EulerStream `room_info` integration for live video + a live session header.
- **1.1.0–1.2.0** — Board-session hardening: v1→v2 connector fix, connection-health, structured logging, crash-safe pipeline, 48→62 tests, Windows prep, auto-update scaffold, compliance gates.

## 1.0.0 — Unified app
- Merged the original LikeTapper live viewer with a web community-manager concept into one Electron desktop app: navy sidebar, dashboard, followers, gifts, reminders, an embedded TikTok messages workspace, and the live tools — rebranded **TikTok Community Manager**.

## 0.x — LikeTapperMac
- The original read-only TikTok LIVE viewer dashboard: comment/gift/like feeds, OBS overlay, highlight clips, session history.
