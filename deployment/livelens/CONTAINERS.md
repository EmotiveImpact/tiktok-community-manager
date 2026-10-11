# Local service container

The default image contains the Node API, Python recorder supervisor, FFmpeg,
the exact optional PostgreSQL/TikTok npm dependency closure, encrypted object
storage and the PDF helper script. It runs as UID 1000. The build context is the
repository root; the service's own lock is used, without installing desktop npm
dependencies. Node's base-image digest is pinned. Debian system packages are
retrieved with their normal signed repository metadata.

```bash
BUILDX_CONFIG=/workspace/.docker-buildx docker build \
  --secret id=proxy_ca,src="$CODEX_PROXY_CERT" \
  -f services/intelligence/Dockerfile -t livelens-intelligence:local .
docker compose -f services/intelligence/compose.yml up --build
```

Use the CA secret when required by the managed proxy. On a conventional machine,
omit that secret argument; the build keeps TLS verification enabled. The Compose
file uses the configured CA or system CA bundle. Preserve injected Docker
authentication; `BUILDX_CONFIG` only selects a writable build-cache directory.

Supply `LIVELENS_API_KEYS` privately before startup. Add configured owner members
with `LIVELENS_WORKSPACE_MEMBERS`; clients receive only their workspace and
scopes. The port binds host loopback. Compose sets no restart policy and grants
no Linux capabilities. A named volume holds SQLite/local media/objects. Mount
selected fixture inputs read-only when using file sources. Public source adapters
need their separately configured provider credentials and authorisation.

The image is API-only by default. A bundle path, renderer JSON or recognizer JSON
does not install or mount those optional dependencies. Missing capabilities are
reported as unavailable.

## Browser bundle

Build the repository frontend with the documented root build command. For a
Compose override stored beside `services/intelligence/compose.yml`, use:

```yaml
services:
  intelligence:
    environment:
      LIVELENS_BUNDLE_DIR: /console
      LIVELENS_CONSOLE_ORIGIN: http://127.0.0.1:4318
    volumes:
      - ../../dist:/console:ro
```

Set `LIVELENS_BROWSER_USERS` privately to the documented static user/password
configuration. The frontend bundle contains no private API key. Launch with both
Compose files. This override mounts an existing built bundle; it does not build
the frontend or create user invitations.

## Optional PDF and independent speech

Prepare an administrator-controlled derived image with a Python virtual
environment, Playwright and Chromium for PDF, and the pinned speech requirements
for PocketSphinx. A Linux virtual environment copied from an unrelated host is
not a portable runtime. One example derived Dockerfile, built from the repository
root after tagging the default image `livelens-intelligence:local`, is:

```dockerfile
FROM livelens-intelligence:local
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-venv chromium libportaudio2 && rm -rf /var/lib/apt/lists/*
RUN --mount=type=secret,id=proxy_ca,required=false \
    python3 -m venv /opt/livelens-python \
    && if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi \
    && /opt/livelens-python/bin/python -m pip install \
       playwright==1.62.0 -r /app/services/intelligence/speech/requirements.txt
USER node
```

Then select that image in a local Compose override and set trusted paths:

```yaml
services:
  intelligence:
    image: livelens-intelligence-optional:local
    environment:
      LIVELENS_PDF_RENDERER: '{"python":"/opt/livelens-python/bin/python","chromium":"/usr/bin/chromium"}'
      LIVELENS_SPEECH_RECOGNIZER: '{"command":"/opt/livelens-python/bin/python","args":["/app/services/intelligence/speech/pocketsphinx_adapter.py","--ffmpeg","/usr/bin/ffmpeg"],"id":"pocketsphinx","language":"en-US","diarization":false}'
```

Build/run the selected derived image deliberately rather than letting the base
Compose build replace it: use `docker compose ... up --no-build` after building
and tagging the selected derived image. These optional recipes require verification on the
target machine and are not a receipt of a tested extended container. The actual
host validation exercised offline Chromium/PDF and PocketSphinx. PocketSphinx
provides no diarisation; source-linked results stay an anonymous track. Models,
browser, FFmpeg redistribution and provider terms require their own review.

For approved external renderer or recognizer tools, mount the complete compatible
runtime/model tree read-only at a fixed container path and point the same JSON
fields there. Caller request bodies never choose executables or model paths.

## PostgreSQL and recovery boundaries

`LIVELENS_POSTGRES_URL` chooses the optional native bridge; set the private URL
and optional `LIVELENS_POSTGRES_SCHEMA` deliberately. Container loopback refers
to the container itself. A separate Compose database must share a configured
network and satisfy the adapter's verified-TLS rule for remote hostnames. The
loopback-only infrastructure evaluation scaffold is not automatically started
by the service Compose file.

The encrypted backup helper covers SQLite and local recorder media only. It
does not back up PostgreSQL or archived object contents. Persist object storage
and encryption keys separately and use the selected database's recovery tools.
No paid provider, hosted deployment or unattended live watch is started by these
instructions.
