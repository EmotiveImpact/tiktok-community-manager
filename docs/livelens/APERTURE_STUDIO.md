# Aperture Studio — implemented in LiveLens

The owner selected **Aperture Studio** on 11 October 2026. The approved
[visual reference](design-concepts/visual-exploration-2026-10-11/01-aperture-studio.png)
now guides the real authenticated application: warm charcoal, off-white actions,
self-hosted Inter, a narrow icon rail, large media and a compact conversation pane.

The next implemented slice is [Aperture workflows](APERTURE_WORKFLOWS.md): whole-recording
transport, complete conversation/library search, stable saved originals and guided
private ALFRED setup. Its screenshots and validation supersede the earlier UI below.

## Initial implementation screenshots

[Open the full-size desktop screenshot](screenshots/aperture-studio/01-conversation-desktop.png).

![Implemented Aperture conversation](screenshots/aperture-studio/01-conversation-desktop.png)

These are browser screenshots of the working app, using a **synthetic demo**.
The studio portrait is generated; FFmpeg recorded that still with a tone into
three retained segments totalling 6.023 seconds. The five caption statements are
an illustrative script inserted through the fixture API, not recognised speech.
Saved-moment thumbnails were decoded from those actual segments. Production
sessions use their own retained media; this portrait is not an app placeholder.

| Screen | Actual capture |
|---|---|
| Conversation, desktop | [1487 × 1058 viewport](screenshots/aperture-studio/01-conversation-desktop.png) · [complete page](screenshots/aperture-studio/01-conversation-full.png) |
| Live monitor | [Desktop](screenshots/aperture-studio/02-monitor-desktop.png) · [390px phone](screenshots/aperture-studio/06-monitor-phone.png) |
| Session library | [Desktop](screenshots/aperture-studio/03-library-desktop.png) |
| Conversation, phone | [Complete page](screenshots/aperture-studio/04-conversation-phone.png) |
| Phone navigation | [Open drawer](screenshots/aperture-studio/05-navigation-phone.png) |

## Working behavior

- Shared 72px desktop rail and header; labelled hover/focus destinations, a
  keyboard-operated More tools popover, workspace access and an ALFRED destination.
  The phone drawer retains its focus trap, Escape and focus restoration.
- Recorded video beside searchable, filterable evidence. Source, capture and
  receipt clocks remain explicit; anonymous tracks do not become account identities.
- Bookmark moment saves the selected evidence. With no selection, it asks the
  operator to choose a statement before writing. Saved moments sit beneath video,
  reopen exact original context and seek covered media, including repeat selection.
- Actual video frames appear only where the event's collector timestamp is covered
  by a retained segment. Missing coverage uses a bookmark icon. Reads are bounded
  to six concurrent decoders, cancelled on context change; up to 100 actual
  bookmarks load per session, six rows at a time. An unloaded event reopens original
  context without inventing its quote, time or image.
- The monitor uses a compact account strip and a wider video/conversation stage.
  Explicit check, bounded watch, record, independent stops and saved replay retain
  their real service behavior. The library uses divided rows and actual loaded
  capture metadata; an unknown video status remains unknown.
- Recording hash, archive and speech tools remain in Recording details & tools.
  Existing investigations, review, reports, governance and ALFRED setup use the
  shared visual frame. Their service and integration contracts are unchanged.

The reference's illustrative waveform, 28-minute duration, relative clocks and
three-dot menu were not implemented as decorative controls. The app displays its
actual segment selector, original clocks, four distinct evidence filters and
working refresh action. Global search accurately describes captured-evidence search.

## Verification and continuation

[Design QA](../../design-qa.md), [measured layout](aperture-studio-layout-validation.json)
and [validation](VALIDATION.md) identify the final artifacts and exercised journeys.
At the reference's exact 1487 × 1058 size, the actual player is 869px wide and its
top aligns with the 470px conversation pane at 205px. Desktop and phone have no
horizontal overflow or uncaught page errors in the recorded checks.

Run `npm run console:fixture` for the standard generated-media development fixture;
the Aperture UI does not require the optional studio demo image. Authentication,
ports and startup are documented in [runtime configuration](RUNTIME_CONFIGURATION.md).
The screenshot-only studio fixture used an isolated temporary database/media tree.

The visual direction is owner-approved. Acceptance of this implementation remains
distinct from that selection. External LIVE quality, broader accessibility/user
testing, guided private ALFRED installation and customer production operation
retain their separate acceptance gates. No deployment or merge is part of this pass.
