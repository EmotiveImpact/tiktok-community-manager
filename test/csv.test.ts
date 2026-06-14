import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './helpers';
import {
  escapeCsv,
  parseCsv,
  importCsv,
  exportCsvText,
  getFan,
  clearAll,
  setRulesGetter,
  DEFAULT_RULES,
} from '../electron/fans';
import { wipeDataDir } from './helpers';

beforeEach(() => {
  wipeDataDir();
  clearAll();
  setRulesGetter(() => DEFAULT_RULES);
});
afterEach(() => {
  clearAll();
});

describe('escapeCsv', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsv('hello')).toBe('hello');
    expect(escapeCsv('')).toBe('');
  });

  it('quotes values containing commas', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes values with embedded newlines / CR', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsv('a\rb')).toBe('"a\rb"');
  });

  it('does NOT neutralise leading =/+/- CSV-injection (documents current behaviour)', () => {
    // escapeCsv only quotes for comma/quote/newline; formula-injection prefixes
    // pass through unescaped. Flagged as a known gap, asserted so a future
    // hardening change will trip this test on purpose.
    expect(escapeCsv('=SUM(A1:A9)')).toBe('=SUM(A1:A9)');
    expect(escapeCsv('+1')).toBe('+1');
    expect(escapeCsv('-2')).toBe('-2');
  });
});

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses quoted cells with embedded commas and doubled quotes', () => {
    const rows = parseCsv('name,note\n"Doe, John","he said ""hi"""');
    expect(rows[1]).toEqual(['Doe, John', 'he said "hi"']);
  });

  it('handles quoted cells containing newlines', () => {
    const rows = parseCsv('a,b\n"multi\nline",x');
    expect(rows[1]).toEqual(['multi\nline', 'x']);
  });

  it('treats CRLF and LF line endings equivalently', () => {
    const lf = parseCsv('a,b\n1,2');
    const crlf = parseCsv('a,b\r\n1,2');
    expect(crlf).toEqual(lf);
  });

  it('ignores a trailing newline (no phantom empty row)', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps rows with differing column counts (extra / missing cells)', () => {
    const rows = parseCsv('a,b,c\n1,2\nx,y,z,w');
    expect(rows[1]).toEqual(['1', '2']); // missing column
    expect(rows[2]).toEqual(['x', 'y', 'z', 'w']); // extra column
  });
});

describe('importCsv -> exportCsvText round-trip', () => {
  it('imports new fans, preserving username/displayName/birthday/tags/notes/totalDiamonds', () => {
    const csv = [
      'username,displayName,birthday,tags,notes,totalDiamonds',
      'alice,Alice A,1990-03-14,vip;whale,"loves, gifts",1500',
      '@bob,Bob B,12-25,newbie,plain note,50',
    ].join('\n');

    const res = importCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.created).toBe(2);
    expect(res.updated).toBe(0);

    const alice = getFan('alice')!;
    expect(alice).toBeTruthy();
    expect(alice.displayName).toBe('Alice A');
    expect(alice.birthday).toBe('03-14'); // ISO normalised
    expect(alice.tags).toEqual(['vip', 'whale']);
    expect(alice.notes).toBe('loves, gifts');
    expect(alice.totalDiamonds).toBe(1500);
    expect(alice.tier).toBe('VIP');

    // @bob -> the leading @ is stripped on import.
    const bob = getFan('bob')!;
    expect(bob).toBeTruthy();
    expect(bob.birthday).toBe('12-25');
    expect(bob.totalDiamonds).toBe(50);

    // Export then re-parse and confirm fields survive the trip.
    const out = exportCsvText();
    const rows = parseCsv(out);
    const header = rows[0];
    const aliceRow = rows.find((r) => r[header.indexOf('username')] === 'alice')!;
    expect(aliceRow[header.indexOf('displayName')]).toBe('Alice A');
    expect(aliceRow[header.indexOf('totalDiamonds')]).toBe('1500');
    expect(aliceRow[header.indexOf('tags')]).toBe('vip; whale');
    expect(aliceRow[header.indexOf('notes')]).toBe('loves, gifts');
    expect(aliceRow[header.indexOf('birthday')]).toBe('03-14');
    expect(aliceRow[header.indexOf('tier')]).toBe('VIP');
  });

  it('merges tags on update and does NOT overwrite totalDiamonds for existing fans', () => {
    importCsv(['username,tags,totalDiamonds', 'carol,gold,200'].join('\n'));
    expect(getFan('carol')!.totalDiamonds).toBe(200);

    // Re-import same fan: new tag should merge with existing; diamonds 9999
    // must be IGNORED because totalDiamonds only seeds brand-new fans.
    const res = importCsv(['username,tags,totalDiamonds', 'carol,silver,9999'].join('\n'));
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);

    const carol = getFan('carol')!;
    expect(carol.tags.sort()).toEqual(['gold', 'silver']); // merged, not replaced
    expect(carol.totalDiamonds).toBe(200); // unchanged — seed-only rule
  });

  it('rejects CSV with no username column and reports empty CSV', () => {
    const noUser = importCsv('displayName,notes\nx,y');
    expect(noUser.ok).toBe(false);
    expect(noUser.errors[0]).toMatch(/username/i);

    const empty = importCsv('');
    expect(empty.ok).toBe(false);
    expect(empty.errors[0]).toMatch(/empty/i);
  });

  it('skips rows with a blank username', () => {
    const res = importCsv(['username,notes', ',orphan note', 'dave,real'].join('\n'));
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
    expect(getFan('dave')).toBeTruthy();
  });

  it('tolerates a UTF-8 BOM on the header', () => {
    // importCsv lower-cases AND .trim()s each header cell, and JS String.trim()
    // strips the U+FEFF BOM, so a BOM-prefixed "username" header is still
    // recognised and the row imports cleanly.
    const bom = '﻿username,notes\neve,hi';
    const res = importCsv(bom);
    expect(res.ok).toBe(true);
    expect(res.created).toBe(1);
    expect(getFan('eve')).toBeTruthy();
  });
});
