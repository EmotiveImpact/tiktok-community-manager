"""Strict backup archive helper. Reject links and traversal; verify SQLite/media."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tarfile


def verify(database, media):
    connection = sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True)
    try:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('database_integrity_failed')
        if connection.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('database_foreign_key_failed')
        checked = 0
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_segments'").fetchone():
            for relative, size, expected in connection.execute('SELECT relative_path,bytes,sha256 FROM media_segments'):
                parts = PurePosixPath(relative)
                if parts.is_absolute() or '..' in parts.parts:
                    raise ValueError('invalid_media_path')
                path = (media / relative).resolve(strict=True)
                if not path.is_relative_to(media.resolve()) or not path.is_file() or path.stat().st_size != size:
                    raise ValueError('missing_media')
                digest = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError('damaged_media')
                checked += 1
        return {'mediaVerified': checked, 'databaseIntegrity': 'ok'}
    finally:
        connection.close()


def pack(database, media, destination):
    database, media = Path(database), Path(media)
    if not media.is_dir() or media.is_symlink():
        raise ValueError('media_directory_required')
    verification = verify(database, media)
    with tarfile.open(destination, 'w') as archive:
        archive.add(database, arcname='intelligence.sqlite', recursive=False)
        for base, directories, files in os.walk(media, followlinks=False):
            for name in directories + files:
                if (Path(base) / name).is_symlink():
                    raise ValueError('media_symlink_refused')
            for name in files:
                path = Path(base) / name
                if not path.is_file():
                    raise ValueError('special_media_file_refused')
                archive.add(path, arcname='media/' + path.relative_to(media).as_posix(), recursive=False)
    return verification


def unpack(source, destination):
    target = Path(destination)
    target.mkdir(mode=0o700)
    (target / 'media').mkdir(mode=0o700)
    seen = set()
    with tarfile.open(source, 'r:') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or member.name in seen or not member.isfile():
                raise ValueError('unsafe_backup_member')
            if member.name != 'intelligence.sqlite' and (not path.parts or path.parts[0] != 'media'):
                raise ValueError('unknown_backup_member')
            seen.add(member.name)
            if len(seen) > 100000:
                raise ValueError('backup_member_limit')
            output = target.joinpath(*path.parts)
            output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.extractfile(member) as incoming, output.open('xb') as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            output.chmod(0o600)
    if 'intelligence.sqlite' not in seen:
        raise ValueError('backup_database_missing')
    return verify(target / 'intelligence.sqlite', target / 'media')


if __name__ == '__main__':
    try:
        operation, *arguments = sys.argv[1:]
        result = pack(*arguments) if operation == 'pack' else unpack(*arguments) if operation == 'unpack' else None
        if result is None:
            raise ValueError('invalid_operation')
        print(json.dumps(result))
    except Exception:
        print('archive_verification_failed', file=sys.stderr)
        sys.exit(1)
