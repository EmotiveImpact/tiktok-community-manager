"""Offline CPU transcription of verified media; no caption input or network I/O.

PocketSphinx does not diarise. A null speakerId deliberately preserves that limit.
"""
import argparse
import ctypes
import importlib.metadata
import json
import os
import re
import signal
import subprocess
import sys

from pocketsphinx import Decoder


def parent_guard():
    parent = os.getppid()
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise RuntimeError("FFmpeg parent-death guard failed")
    if os.getppid() != parent:
        os._exit(1)


def transcribe(args):
    # Input is a retained local file path from Recorder.media(), never a URL.
    if not os.path.isfile(args.input) or not os.path.isabs(args.ffmpeg):
        raise ValueError("Verified local file and configured absolute FFmpeg required")
    if not 1 <= args.duration_ms <= 3_600_000:
        raise ValueError("Invalid audio duration")
    decoded = subprocess.run(
        [args.ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", args.input,
         "-vn", "-ac", "1", "-ar", "16000", "-t", str(args.duration_ms / 1000),
         "-f", "s16le", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=True,
        preexec_fn=parent_guard,
    ).stdout
    if len(decoded) > 115_200_000:
        raise ValueError("Audio decode capacity exceeded")
    if not decoded:
        raise ValueError("Media has no decodable audio")
    decoder = Decoder(samprate=16000, loglevel="ERROR")
    decoder.start_utt()
    decoder.process_raw(decoded, False, True)
    decoder.end_utt()
    words = []
    for word in decoder.seg():
        if word.word.startswith("<") or word.word.startswith("["):
            continue
        start_ms = word.start_frame * 10
        end_ms = min(args.duration_ms, (word.end_frame + 1) * 10)
        if end_ms <= start_ms:
            continue
        # PocketSphinx word posterior probability is retained as returned. It is
        # not presented as an accuracy guarantee or inferred speaker identity.
        confidence = min(1.0, max(0.0, float(word.prob)))
        lexical_word = re.sub(r"\(\d+\)$", "", word.word)
        words.append({"startMs": start_ms, "endMs": end_ms, "text": lexical_word,
                      "speakerId": None, "confidence": confidence})
    # Keep bounded journal writes and useful phrase chunks, preserving exact
    # recognizer start/end frames. Long silence starts a new phrase.
    phrases = []
    for word in words:
        if not phrases or word["startMs"] - phrases[-1]["endMs"] > 600 or len(phrases[-1]["text"]) > 300:
            phrases.append(dict(word))
        else:
            phrase = phrases[-1]
            phrase["text"] += " " + word["text"]
            phrase["endMs"] = word["endMs"]
            phrase["confidence"] = min(phrase["confidence"], word["confidence"])
    if len(phrases) > 200:
        raise ValueError("Transcript capacity exceeded")
    return {"schemaVersion": 1, "engine": {"id": "pocketsphinx", "version": importlib.metadata.version("pocketsphinx"),
            "language": "en-US", "diarization": False}, "segments": phrases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--duration-ms", type=int, required=True)
    parser.add_argument("--ffmpeg", default="/usr/bin/ffmpeg")
    options = parser.parse_args()
    try:
        print(json.dumps(transcribe(options), ensure_ascii=False))
    except Exception:
        # Keep private file paths and diagnostic text outside browser receipts.
        print("Speech engine could not process verified audio", file=sys.stderr)
        sys.exit(1)
