"""Download checksum-pinned reference data only; never execute upstream files."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request
import wave

parser = argparse.ArgumentParser()
parser.add_argument("--output-dir", required=True)
parser.add_argument("--archive", help="Previously downloaded source archive")
args = parser.parse_args()
manifest = json.loads(Path(__file__).with_name("reference_manifest.json").read_text())
archive = Path(args.archive).read_bytes() if args.archive else urllib.request.urlopen(manifest["archiveUrl"], timeout=60).read()
if hashlib.sha256(archive).hexdigest() != manifest["archiveSha256"]:
    raise ValueError("Reference archive integrity failure")
root = Path(args.output_dir)
root.mkdir(parents=True, exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(archive)) as source:
    for reference in manifest["references"]:
        data = source.extractfile("pocketsphinx-5.1.1/" + reference["path"]).read()
        if hashlib.sha256(data).hexdigest() != reference["sha256"]:
            raise ValueError("Reference audio integrity failure")
        output = root / (reference["id"] + ".wav")
        if reference["encoding"] == "wav":
            output.write_bytes(data)
        else:
            with wave.open(str(output), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(data)
print(json.dumps({"prepared": [r["id"] for r in manifest["references"]], "sourceArchiveSha256": manifest["archiveSha256"]}))
