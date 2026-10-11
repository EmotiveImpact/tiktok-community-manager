# Independent speech worker

`../src/speech.mjs` runs an explicitly configured recognizer against retained
media already verified by `Recorder.media()`. It does not consume TikTok captions
or a supplied transcript. SQLite retains job bounds, exact segment hashes,
attempts, validated recognizer results, stop requests and restart progress.
Recognition produces ordinary workspace-bound evidence that existing search,
identity assertions, cases and reports can use.

The supplied engine is **PocketSphinx 5.1.1**, an offline CPU English decoder.
It is a measured baseline: it provides real independent transcription, and it
does **not** provide diarisation. All its results remain an anonymous,
unseparated audio track. An operator can assert an account separately, with
the existing review/history contract. No handle or real-world identity is
inferred from the recording.

## Install and configure

The engine is optional. The Node service itself adds no npm dependencies. This
environment installed the pinned Python packages outside the repository at
`/workspace/.venv-speech`; the environment is not shipped in Git.

```bash
python3 -m venv /workspace/.venv-speech
CC=/usr/bin/gcc CXX=/usr/bin/g++ /workspace/.venv-speech/bin/python -m pip install -r services/intelligence/speech/requirements.txt
```

Use trusted absolute paths for the command and FFmpeg. The class configuration
looks like this; HTTP clients cannot supply recognizer executables, arguments,
media paths or model settings:

```js
new SpeechWorker({
  store,
  recorder,
  recognizer: {
    command: '/workspace/.venv-speech/bin/python',
    args: [
      '/workspace/tiktok-community-manager/services/intelligence/speech/pocketsphinx_adapter.py',
      '--ffmpeg', '/usr/bin/ffmpeg',
    ],
    id: 'pocketsphinx', language: 'en-US', diarization: false,
  },
});
```

The adapter decodes local media to mono 16 kHz PCM with configured FFmpeg, then
uses PocketSphinx's bundled English acoustic model, language model and dictionary.
Runtime audio processing makes no network calls. Missing packages, unsupported
audio and execution failures fail the bounded job rather than use captions as
replacement speech.

## Durable job and adapter contracts

- `create(workspace, {id?, sessionId, recordingJobId, segmentIds?, maxDurationSeconds?})`
  snapshots available verified segment receipts. With no segment IDs, it takes
  the currently retained segments; future capture segments require another job.
- `job(workspace, id)`, `list(workspace, {sessionId?, limit?})`, `stop(workspace, id)`
  return persisted receipts and progress. Other workspaces cannot see a job.
- `capabilities()`, `start()` and `await close()` report/start/stop the configured
  worker. Closing is idempotent. Enabling the engine alone does not start a monitor.

Jobs accept 5–3,600 seconds of elapsed wall-clock time from creation, including
queue/retries. Input is capped at 120 retained segments and one hour of media,
with 100 outstanding jobs, one concurrent worker and three attempts per segment.
A SQLite lease prevents duplicate active workers. Graceful close or abrupt Node
death leaves restart receipts; Linux parent-death handling terminates the engine.
Timeout/stop kills its process group. The supplied FFmpeg decode child also has
parent-death handling. Additional adapters must bound their own descendant work.

The recognizer receives fixed trusted arguments followed by
`--input VERIFIED_LOCAL_PATH --duration-ms MEDIA_DURATION`. Standard output must
be one bounded JSON result (512 kB, at most 200 phrase segments):

```json
{
  "schemaVersion": 1,
  "engine": {"id":"pocketsphinx","version":"5.1.1","language":"en-US","diarization":false},
  "segments": [
    {"startMs":460,"endMs":2120,"text":"go forward ten meters","speakerId":null,"confidence":0.188}
  ]
}
```

Times are offsets inside that exact segment, not invented provider timestamps.
Offsets/confidence, allowed fields, engine ID/language, speaker IDs and
diarisation claims are validated. The original media hash is checked again
after inference and before evidence publication. Results are durably stored
before journal ingestion, allowing retries to preserve the original engine
output rather than rerun already recognised content. Transcript text is data,
including any command-like words; the worker never executes or follows it.

Optional adapters can provide validated anonymous diarisation tracks when they
actually support that capability. That contract is not proof that a speaker
separation model has been installed or evaluated. Track IDs are scoped to the
media segment; independently decoded chunks do not establish that similarly
numbered speakers are the same voice across chunks.

## Measured reference evaluation

Preparation downloads the exact checksum-pinned PocketSphinx source distribution
and extracts only three known-audio fixtures. It does not run upstream code.
Reference audio is kept outside Git; the source URL, exact checksums and expected
words are in `reference_manifest.json`.

```bash
python3 services/intelligence/speech/prepare_reference.py --output-dir /tmp/livelens-speech-references
/workspace/.venv-speech/bin/python services/intelligence/speech/evaluate.py --reference-dir /tmp/livelens-speech-references
LIVELENS_SPEECH_REFERENCE_DIR=/tmp/livelens-speech-references LIVELENS_SPEECH_PYTHON=/workspace/.venv-speech/bin/python node --test services/intelligence/test/speech.test.mjs
```

The recorded local run in `evaluation.json` recognised 15.186 seconds / 40 words
in 3.895 seconds, with aggregate **30% word error rate**. The short four-word
command was exact; the literary excerpts had 36.4% and 28.6% error rates. WER
includes insertion/deletion/substitution, with lowercase punctuation tokenisation;
pronunciation-alternative suffixes are removed from words, but text is not forced
to the reference. Timings include decoder startup and FFmpeg audio extraction.
These three short single-speaker English excerpts do not establish livestream
accuracy, user capacity, hardware scaling, multilingual support or reliable
overlap separation. Speaker-overlap evaluation is explicitly unavailable.

The automated tests include schema refusal, an actual configured subprocess,
workspace isolation, damaged-media refusal, deadline/retry bounds, explicit stop,
database reopening and an actual SIGKILL service/engine/lease-recovery test. If
the optional environment/reference audio exists, an additional test runs the
real PocketSphinx decoder and verifies its exact retained-media evidence range.
Without those local prerequisites that one test reports a clear skip; the test
adapter used in the other tests is labelled a fixture, not independent speech.

## Deliberate runtime and licence route

No research repository code, scripts or models are imported. The worker and
adapter are original LiveLens code. PocketSphinx is a new explicit Python engine
dependency outside the Node process, not an adopted research submodule.
`runtime_inventory.json` records exact Python package versions, source artifact
URLs/SHA-256, retained notices and bundled model-file hashes. `runtime-licences/`
retains PocketSphinx, its model notice and installed transitive dependency notices.

PocketSphinx includes BSD-style CMU code, WebRTC BSD terms and MIT portions.
The bundled English acoustic model has its own Alpha Cephei BSD-style notice.
Installed dependencies are `sounddevice 0.5.6`, `cffi 2.1.1`, `pycparser 3.11`.
Build tools are not runtime engines. Existing configured FFmpeg licensing remains
separate. The source test excerpts are reference data from the same pinned source
archive (including LibriVox excerpts); this records provenance rather than
asserting universal commercial clearance of every future dataset/model/build.

Installation/reference preparation contact PyPI distribution hosts. Actual
recognition uses local audio/models only, no API keys or paid providers. Disable
speech recognizer configuration to roll back the worker while preserving retained
media, transcript provenance and existing case evidence.
