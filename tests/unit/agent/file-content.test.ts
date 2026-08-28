import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `write_file` used to coerce its `content` argument with a helper that turns
 * anything non-string into `''`. A real GLM-5.2 run emitted `content` as a JSON
 * **object** for `package.json` — which models do routinely when the target file
 * is itself JSON — so 262 bytes of correct manifest became a 0-byte file, and
 * the transcript reported "Wrote package.json" as a success.
 *
 * Silent data loss reported as success is the failure mode worth a test.
 */

const persisted: Array<{ path: string; content: string }> = [];

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    insert: () => ({
      values: (row: { path: string; content: string }) => ({
        onConflictDoUpdate: async () => {
          persisted.push({ path: row.path, content: row.content });
        },
      }),
    }),
  },
}));

const { BUILTIN_TOOL_HANDLERS } = await import('@/lib/agent/tools');
const { DEFAULT_AGENT_PERMISSIONS } = await import('@/lib/agent/policy');

function context() {
  return {
    projectId: 'prj_test',
    sandboxId: null,
    provider: null,
    permissions: { ...DEFAULT_AGENT_PERMISSIONS, autoApproveEdits: true },
    knownSecrets: [],
    runId: 'run_test',
    onFileChange: () => {},
  };
}

const writeFile = BUILTIN_TOOL_HANDLERS.write_file!;

beforeEach(() => {
  persisted.length = 0;
});

describe('write_file content coercion', () => {
  it('writes a string body unchanged', async () => {
    const result = await writeFile({ path: 'a.txt', content: 'hello' }, context());
    expect(result.isError).toBe(false);
    expect(persisted.at(-1)?.content).toBe('hello');
  });

  it('serialises an object body instead of writing an empty file', async () => {
    const manifest = { name: 'karo-shortener', type: 'module', version: '1.0.0' };
    const result = await writeFile({ path: 'package.json', content: manifest }, context());

    expect(result.isError).toBe(false);
    const written = persisted.at(-1)?.content ?? '';
    expect(written, 'the body must not be lost').not.toBe('');
    expect(JSON.parse(written)).toEqual(manifest);
  });

  it('serialises an array body', async () => {
    const result = await writeFile({ path: 'list.json', content: [1, 2, 3] }, context());
    expect(result.isError).toBe(false);
    expect(JSON.parse(persisted.at(-1)?.content ?? '')).toEqual([1, 2, 3]);
  });

  it('refuses a missing body rather than creating an empty file', async () => {
    const result = await writeFile({ path: 'a.txt' }, context());
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/requires `content`/);
    expect(persisted).toHaveLength(0);
  });

  it('refuses a scalar body it cannot interpret', async () => {
    const result = await writeFile({ path: 'a.txt', content: 42 }, context());
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/expects `content` to be a string/);
    expect(persisted).toHaveLength(0);
  });

  it('still writes a deliberately empty string', async () => {
    const result = await writeFile({ path: 'empty.txt', content: '' }, context());
    expect(result.isError).toBe(false);
    expect(persisted.at(-1)?.content).toBe('');
  });
});
