# LiveLens upstream research shelf

These **eight public repositories** are included as **pinned Git submodules**.
Their original source, history and licence stay in their own projects; they
are NOT automatically installed, executed, bundled or integrated with
the existing app. See [catalogue.lock.json](catalogue.lock.json) for exact
revision IDs, licences, integration roles and risks.

## Get the upstream code into a clone

~~~sh
git submodule update --init research/upstream
~~~

Or fetch just one for review:

~~~sh
git submodule update --init research/upstream/whisperlivekit
git submodule update --init research/upstream/xploitvoid-tiktok-live-recorder
~~~

Use the recorded gitlink commits, not \`--remote\`. Do **not** use
\`--recursive\` before reviewing nested submodule sources. Nothing is
executed by this checkout. Do not install dependencies or run unfamiliar
scripts or Docker images without a security review.

~~~sh
python3 research/upstream/verify_pins.py
~~~

verifies all eight pinned revisions in the Git tree against the manifest,
without network access or running the source.

## Licence and reuse cautions

- **PieterVanBoheemen/tiktoklive_monitor** has no detected licence file or
  GitHub licence metadata at the pinned revision. Reference only; do not
  copy its code into a commercial product without permission.
- **isaackogan/TikTokLive** and **zerodytrash/TikTok-Live-Connector** have
  modified AGPL-3.0 terms with additional clauses. Commercial/service
  use requires reading their actual licences, even though they are public.
- **MIT** (XploitVoid, Michele, pyannote) and **Apache-2.0**
  (WhisperLiveKit, Detoxify) may permit reuse subject to conditions;
  model checkpoints and transitive dependencies can have separate terms.
- The existing Community Manager already depends on the Node connector
  family; this is a specific item to review before selling a hosted service.
- TikTok data access remains an unofficial and changeable source. Do not
  infer user or stream access rights from a library licence.

## Comparative review order

1. **Recording + chat replay:** XploitVoid vs Michele. Audit error recovery,
   FFmpeg invocations, event/media timestamps and actual recordings.
2. **Long-lived multi-channel scheduling:** ideas from Pieter, but no
   unlicensed source-code copy.
3. **Speech:** benchmark WhisperLiveKit first, pyannote as diarisation
   comparison; keep model workers separate from the TypeScript services.
4. **Events:** prefer one adapter boundary, compare the two connector
   implementations without shipping both as tangled dependencies.
5. **Potential harm detection:** Detoxify is optional classifier input,
   never proof of abuse or an automated judgement about a person.

No source was executed or tested as part of this research commit.
