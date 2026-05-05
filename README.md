# LikeTapperMac

A read-only TikTok Live viewer dashboard for macOS. Connect to any public TikTok Live by `@username` and watch likes, comments, gifts, follows, and viewer counts stream into a clean, dark-mode dashboard.

> **Receive-only.** This app does **not** send likes, comments, gifts, or any other interaction. Auto-engagement on TikTok violates their Terms of Service and gets accounts banned. This tool is for monitoring public Live event streams only — the same data overlays and gift trackers consume.

## Stack

- Electron + Vite + React + TypeScript + Tailwind
- [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector) for the Webcast event stream
- Zustand for renderer state
- electron-store for settings

## Run

```bash
npm install      # or pnpm install
npm run dev      # launches Vite + Electron
```

To package a `.dmg`:

```bash
npm run dist
# output → release/LikeTapperMac-<version>.dmg
```

The first launch of the unsigned app on macOS will be blocked by Gatekeeper. Right-click → Open, then confirm; or run `xattr -dr com.apple.quarantine /Applications/LikeTapperMac.app`.

## Sign API key (the one thing that breaks)

`tiktok-live-connector` does its initial Webcast handshake through a signing service ([EulerStream](https://www.eulerstream.com/)). The free tier handles light usage. If you hit rate limits or get handshake errors, grab an EulerStream key and paste it into the in-app **Settings** panel (gear icon, top-right). It's persisted via electron-store.

## What you'll see

- **Likes panel** — giant heart, total likes, real-time likes-per-second
- **Stats** — viewers, diamonds (gift value), follows, uptime
- **Comments tab** — live chat feed
- **Gifts tab** — gift names, sender, repeat count, diamond value
- **All tab** — every event in chronological order

## What's not in v1

- Sending any interaction (excluded by design)
- OBS browser-source overlay
- Multiple simultaneous Lives
- Historical persistence / export
- Auto-update

## ToS note

Receiving public Live events sits in a gray area of TikTok's ToS. This app does the same thing as widely-used stream overlays and chatbot integrations, but TikTok may still prohibit unofficial clients in their terms. Use at your own risk; do not use the data for engagement manipulation, harassment, or scraping personal data.
