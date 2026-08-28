import { describe, expect, it } from 'vitest';

import { buildTar } from '@/lib/sandbox/providers/local-docker';

/**
 * The tar writer in the local-docker provider decides where an uploaded file
 * lands in the container. A name it cannot represent must not be truncated:
 * that writes the file to a path the caller never asked for, and two long paths
 * sharing a first segment would silently overwrite each other.
 *
 * These tests read the archive back the way a tar reader does, so they check the
 * bytes on the wire rather than the writer's own idea of them.
 */

const BLOCK = 512;

type Entry = { path: string; size: number; typeFlag: string; content: Buffer };

/** Parses the subset of tar that `buildTar` emits, GNU long names included. */
function readTar(archive: Buffer): Entry[] {
  const entries: Entry[] = [];
  let pendingLongName: string | null = null;

  for (let offset = 0; offset + BLOCK <= archive.length; offset += BLOCK) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    expect(checksumOf(header)).toBe(storedChecksum(header));
    expect(field(header, 257, 6)).toBe('ustar');

    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const content = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (typeFlag === 'L') {
      pendingLongName = content.toString('utf8').replace(/\0+$/, '');
      continue;
    }

    entries.push({
      path: pendingLongName ?? (prefix ? `${prefix}/${name}` : name),
      size,
      typeFlag,
      content,
    });
    pendingLongName = null;
  }

  return entries;
}

function field(header: Buffer, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

function storedChecksum(header: Buffer): number {
  return Number.parseInt(field(header, 148, 8).trim(), 8);
}

/** The checksum is computed with its own field read as eight spaces. */
function checksumOf(header: Buffer): number {
  const blanked = Buffer.from(header);
  blanked.fill(0x20, 148, 156);
  return blanked.reduce((sum, byte) => sum + byte, 0);
}

function file(path: string, content = 'x') {
  return { path, content: Buffer.from(content, 'utf8'), mode: 0o644 };
}

describe('buildTar', () => {
  it('round-trips a short path and its content', () => {
    const entries = readTar(buildTar([file('src/index.ts', 'export const x = 1;')]));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('src/index.ts');
    expect(entries[0]?.content.toString('utf8')).toBe('export const x = 1;');
    expect(entries[0]?.typeFlag).toBe('0');
  });

  it('keeps a path longer than the 100-byte name field intact', () => {
    const path = `${'directory-with-a-long-name/'.repeat(5)}component.tsx`;
    expect(path.length).toBeGreaterThan(99);

    const entries = readTar(buildTar([file(path)]));
    expect(entries[0]?.path).toBe(path);
  });

  it('does not collide two long paths that share their first 100 bytes', () => {
    const shared = 'a'.repeat(120);
    const first = `${shared}/one.txt`;
    const second = `${shared}/two.txt`;

    const entries = readTar(buildTar([file(first, 'first'), file(second, 'second')]));
    expect(entries.map((entry) => entry.path)).toEqual([first, second]);
    expect(entries[0]?.content.toString('utf8')).toBe('first');
    expect(entries[1]?.content.toString('utf8')).toBe('second');
  });

  it('carries a path too long for name and prefix together', () => {
    // 300 bytes cannot fit in the 100-byte name plus the 155-byte prefix, so
    // this exercises the GNU long-name member.
    const path = `${'nested/'.repeat(40)}deep.txt`;
    expect(path.length).toBeGreaterThan(255);

    const entries = readTar(buildTar([file(path, 'deep')]));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(path);
    expect(entries[0]?.content.toString('utf8')).toBe('deep');
  });

  it('carries a single path component too long to ever split', () => {
    // No `/` falls inside the legal split window, so the ustar fields cannot
    // describe this name at all however it is divided.
    const path = `dir/${'ф'.repeat(60)}.txt`;
    expect(Buffer.byteLength(path, 'utf8')).toBeGreaterThan(100);

    const entries = readTar(buildTar([file(path)]));
    expect(entries[0]?.path).toBe(path);
  });

  it('never splits a multi-byte character across the name field', () => {
    // 'ф' is two bytes, so 50 of them plus the prefix land the 100-byte
    // boundary in the middle of a character.
    const path = `${'ф'.repeat(50)}/файл.txt`;
    const archive = buildTar([file(path)]);

    const entries = readTar(archive);
    expect(entries[0]?.path).toBe(path);

    // Whatever the writer chose, the raw name field must still decode cleanly.
    for (let offset = 0; offset + BLOCK <= archive.length; offset += BLOCK) {
      const raw = archive.subarray(offset, offset + 100);
      expect(raw.toString('utf8')).not.toContain('�');
    }
  });

  it('pads every member to a 512-byte block and terminates the archive', () => {
    const archive = buildTar([file('a.txt', 'a'), file('b.txt', 'b'.repeat(600))]);
    expect(archive.length % BLOCK).toBe(0);
    expect(archive.subarray(archive.length - 1024).every((byte) => byte === 0)).toBe(true);
    expect(readTar(archive)).toHaveLength(2);
  });

  it('records the byte length of multi-byte content, not its character count', () => {
    const content = 'приве́т';
    const entries = readTar(buildTar([file('greeting.txt', content)]));
    expect(entries[0]?.size).toBe(Buffer.byteLength(content, 'utf8'));
    expect(entries[0]?.content.toString('utf8')).toBe(content);
  });
});
