# LiveLens source library

All eight previously identified repositories are imported as Git submodules under
`upstream/`, pinned to exact commits in `upstream-lock.json`. These are complete
repository checkouts, not copied excerpts: 850 upstream tracked files in total.
Upstream Git history is shallow. External model weights, datasets, package
dependencies and remote services are not downloaded or installed by this import.
Bundled assets are retained, including WhisperLiveKit's three tracked Silero VAD
ONNX files. Retaining a bundled asset does not establish its fitness or clear
its separate terms for runtime adoption.

Initialise after cloning this project:

```bash
git submodule update --init --depth 1
node scripts/research/verify-upstreams.mjs --checkouts
```

The verifier checks the lock against both Git's recorded submodule commits and
the checked-out heads. CI can verify committed pins without fetching submodules:
`node scripts/research/verify-upstreams.mjs`.

Read [REUSE_REGISTER.md](REUSE_REGISTER.md) for adoption decisions. Source imports
are research inputs. They are excluded from normal application tests and packaged
Electron builds and are not imported by the new intelligence service.

Each upstream retains its original licence and notices. In particular, both
TikTok connector projects include AGPL-based additional terms concerning hosted
services. The monitor README claims MIT, but its pinned tree has no licence file.
An upstream application's root licence does not settle its dependencies, assets,
models or access-provider terms.
