# LiveLens

Live conversation intelligence, developed from the existing TikTok Community
Manager. The wider product connects collection, searchable evidence,
investigations, reporting and ALFRED through one scoped service interface.

The private operator release includes an authenticated browser console, durable
evidence/cases/reports, explicit desktop archiving and a bounded recorder with
verified media replay and restart recovery. Eight pinned upstream repositories
remain research sources. Existing community/CRM workflows remain available.
See [first-release setup and validation](docs/livelens/FIRST_RELEASE.md).
Run `npm run console:fixture` for the labelled local fixture application; this
does not connect a real LIVE or enable paid operation.

- [Platform vision and build sequence](docs/livelens/PLATFORM.md)
- [Full app blueprint, design and consolidated plans](docs/livelens/APP_BLUEPRINT.md)
- [Current implementation and handoff](docs/livelens/HANDOFF.md)
- [Cloud build handoff and continuation prompt](docs/livelens/CLOUD_HANDOFF.md)
- [Source library and reuse decisions](research/REUSE_REGISTER.md)
- [Intelligence service: demo, API and tests](services/intelligence/README.md)
- [ALFRED integration contract](docs/livelens/ALFRED_INTEGRATION.md)
- [Tracked implementation backlog](plans/livelens-backlog.json)

Try the independent service demonstration with Node 24 or later:

```bash
npm --prefix services/intelligence run demo
```

This demonstration uses synthetic evidence. Server recording, speech processing,
the new operating console and registered ALFRED tools are tracked future work.

## Existing TikTok Community Manager

A desktop **fan CRM + live command center** for TikTok LIVE creators. Connect to a public LIVE by `@username` and watch comments, gifts, likes, and follows stream in — while every gifter is quietly captured into a permanent fan ledger you can browse, annotate, and act on long after the stream ends.

TikTok forgets who supported you after ~60 days. This app never does.

> **Read-only.** This app does **not** send likes, comments, gifts, DMs, or any interaction on your behalf. It monitors public LIVE event streams (the same data overlays/gift-trackers consume) and helps you remember and follow up with your supporters. Automating engagement violates TikTok's Terms — this tool is built to stay on the right side of that line.

## What it does

**Live command center**
- Real-time Comments / Gifts / Q&A / Top / All feeds
- Connection-health indicator that tells you *why* a connection drops (offline · private/sub-only LIVE · rate-limited · signing-failed) instead of looping forever
- Embedded stream view (mobile by default; HD video via EulerStream `room_info` on a paid tier) with **persistent background audio** — keep listening while you browse the CRM
- Live tools: moderation, tracked users, alerts, transcript, highlight clips, room members, multi-room, analytics
- A live **Fan Memory** panel — click any fan mid-stream to see their whole history; a returning whale even pops up automatically

**Fan CRM**
- **360° fan profiles** — a pinned "About" + a dated activity timeline (gifts, notes, sessions) in one place
- **Universal peek drawer** — click a fan anywhere (Followers, Gifts, Dashboard, Reach-out) to glance at their full record without leaving your place
- **Global ⌘K** — jump to any fan or page instantly
- **Relationship-strength engine** — a 0–100 score + temperature (hot/warm/cooling/**cold**) computed from recency, generosity, frequency, and loyalty; surfaces who's "going cold"
- **People-queue dashboard** — "Reach out today / Going cold / Reminders due / Notable gifters" alongside your stats, after-LIVE follow-up, recent sessions, and top-supporter spotlight
- **Reach out** workspace + a thank-you composer (copy a personalized message → open their TikTok to send)
- Tiers (New/Regular/VIP/Whale), tags, custom fields, birthdays, CSV import/export
- Go-live desktop notifications when a watched creator starts streaming

## Stack

- Electron + Vite + React 18 + TypeScript + Tailwind v3 + zustand
- UI built on `@radix-ui` primitives (Dialog, DropdownMenu, Tabs, Tooltip, Select, Switch) with a CSS-variable token design system (dark + light)
- [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector) (v2) + EulerStream for the Webcast event stream / signing
- Local-first persistence: a JSON fan ledger + append-only gift log in `~/Documents/LikeTapperMac/`
- electron-log (logging), electron-updater (auto-update), ffmpeg-static (highlight clips)

## Run

```bash
npm install
npm run dev       # Vite + Electron
npm test          # vitest (fan-ledger, strength engine, CSV, migrations)
npm run build     # typecheck + bundle
npm run dist      # package the macOS .dmg into release/
```

Browser preview (no Electron / mock data): `npm run build && (cd dist && python3 -m http.server 3000)`, then open `http://localhost:3000`. Deep-links: `?page=dashboard|live|followers|fan&fan=<id>|gifts|reminders|messages|import|settings`, `?peek=<id>`, `?cmdk=1`, `?theme=light`.

## Honest caveats

- The TikTok connection layer is **unofficial** (reverse-engineered) and can break when TikTok changes things; the app surfaces this clearly and reconnects.
- Only **public** LIVEs can be read — private/subscriber-only LIVEs are inaccessible to any read-only tool.
- **HD in-app video** and accurate viewer counts use EulerStream's `room_info` endpoint, which needs a paid plan; the free tier still signs the connection and the CRM works fully. The app shows an honest upgrade prompt.
- Distribution requires code-signing/notarization (Apple Developer account) — the build config is scaffolded.

## License

MIT (see `LICENSE`).
