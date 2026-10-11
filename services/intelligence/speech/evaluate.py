"""Measure actual offline decoder text error and wall-clock latency."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import re
import subprocess
import sys
import time
import wave


def words(value):
    return re.findall(r"[a-z0-9']+", value.lower())


def edit_distance(reference, hypothesis):
    row = list(range(len(hypothesis) + 1))
    for index, token in enumerate(reference, 1):
        following = [index]
        for column, guessed in enumerate(hypothesis, 1):
            following.append(min(row[column] + 1, following[-1] + 1, row[column - 1] + (token != guessed)))
        row = following
    return row[-1]


parser = argparse.ArgumentParser()
parser.add_argument("--reference-dir", required=True)
parser.add_argument("--ffmpeg", default="/usr/bin/ffmpeg")
parser.add_argument("--output")
args = parser.parse_args()
root = Path(__file__).parent
manifest = json.loads((root / "reference_manifest.json").read_text())
samples = []
for reference in manifest["references"]:
    path = Path(args.reference_dir) / (reference["id"] + ".wav")
    with wave.open(str(path)) as audio:
        duration_ms = round(audio.getnframes() / audio.getframerate() * 1000)
    start = time.perf_counter()
    process = subprocess.run([sys.executable, str(root / "pocketsphinx_adapter.py"), "--input", str(path.resolve()),
                              "--duration-ms", str(duration_ms), "--ffmpeg", args.ffmpeg],
                             capture_output=True, text=True, check=True, timeout=120)
    latency_ms = round((time.perf_counter() - start) * 1000)
    result = json.loads(process.stdout)
    hypothesis = " ".join(segment["text"] for segment in result["segments"])
    expected = words(reference["text"])
    errors = edit_distance(expected, words(hypothesis))
    samples.append({"referenceId": reference["id"], "audioSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "audioDurationMs": duration_ms, "latencyMs": latency_ms, "realTimeFactor": round(latency_ms / duration_ms, 4),
                    "referenceText": reference["text"], "hypothesis": hypothesis,
                    "referenceWords": len(expected), "wordErrors": errors, "wordErrorRate": errors / len(expected),
                    "transcriptSegments": result["segments"], "engine": result["engine"]})
receipt = {"schemaVersion": 1, "fixture": "checksum-pinned PocketSphinx single-speaker test corpus excerpts",
           "runtime": {"pythonVersion": platform.python_version(), "platform": platform.system() + " " + platform.machine(),
                       "ffmpegVersion": subprocess.check_output([args.ffmpeg, "-version"], text=True).splitlines()[0],
                       "runtimeInventorySha256": hashlib.sha256((root / "runtime_inventory.json").read_bytes()).hexdigest()},
           "mode": "actual independent CPU recognition; no captions or forced text",
           "samples": samples, "aggregateWordErrorRate": sum(s["wordErrors"] for s in samples) / sum(s["referenceWords"] for s in samples),
           "totalAudioMs": sum(s["audioDurationMs"] for s in samples), "totalLatencyMs": sum(s["latencyMs"] for s in samples),
           "speakerOverlapEvaluation": {"status": "unavailable", "reason": "PocketSphinx does not diarise; references have no overlapping speaker truth."},
           "limitations": manifest["limitations"]}
encoded = json.dumps(receipt, indent=2) + "\n"
if args.output:
    Path(args.output).write_text(encoded)
print(encoded)
