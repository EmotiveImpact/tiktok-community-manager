#!/usr/bin/env python3
"""Verify eight pinned gitlinks and manifest without fetching or running upstream."""
import configparser
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def verify():
    data = json.loads((ROOT / "research/upstream/catalogue.lock.json").read_text())
    conf = configparser.ConfigParser(interpolation=None)
    conf.read(ROOT / ".gitmodules")
    rows = data["items"]
    errors = []
    if len(rows) != 8:
        errors.append("expected eight upstream rows")
    seen = set()
    expected_sections = set()
    for item in rows:
        path = item["submodule_path"]
        sha = item["revision"]
        upstream = item["repository"]
        section = f'submodule "{path}"'
        expected_sections.add(section)
        if path in seen:
            errors.append("duplicate path " + path)
        seen.add(path)
        if not path.startswith("research/upstream/") or ".." in path.split("/"):
            errors.append("unsafe path " + path)
        if not re.fullmatch(r"[a-f0-9]{40}", sha):
            errors.append("bad sha " + path)
        if section not in conf:
            errors.append("missing submodule " + path)
        else:
            if conf[section].get("url") != f"https://github.com/{upstream}.git":
                errors.append("wrong URL " + path)
            if conf[section].get("path") != path:
                errors.append("wrong submodule path " + path)
        if item.get("linked_to_production") is not False:
            errors.append("unexpected runtime adoption " + path)
        p = subprocess.run(["git","-C",str(ROOT),"ls-tree","HEAD","--",path],
                           capture_output=True,text=True,check=False)
        if p.returncode or p.stdout.strip() != f"160000 commit {sha}\t{path}":
            errors.append("gitlink mismatch " + path)
    if set(conf.sections()) != expected_sections:
        errors.append("submodule list differs from lockfile")
    return errors


if __name__ == "__main__":
    try:
        problems = verify()
    except (OSError, ValueError, configparser.Error) as exc:
        problems = [str(exc)]
    if problems:
        print("\n".join(problems),file=sys.stderr)
        raise SystemExit(1)
    print("All eight LiveLens upstream gitlinks match their immutable catalogue pins")
