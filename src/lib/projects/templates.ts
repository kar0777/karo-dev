import 'server-only';

import { eq } from 'drizzle-orm';

import { normalizeWorkspacePath } from '@/lib/agent/policy';
import { languageFor } from '@/lib/agent/tools';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { projectFiles } from '@/lib/db/schema';
import {
  PROJECT_TEMPLATES_SETTING_KEY,
  PROJECT_TEMPLATE_SEEDS,
  type ProjectTemplateSeed,
} from '@/lib/db/seed-data';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { getSetting } from '@/lib/settings';

/**
 * Project starter templates.
 *
 * Templates are *data*, not code: they live in `admin_settings` under
 * `project.templates`, so an operator can add or fix one without a migration or
 * a deploy. The compiled seeds are the fallback, which means a fresh clone that
 * has never run `db:seed` still creates working projects.
 */

const log = createLogger('projects:templates');

export type { ProjectTemplateSeed };

/** Shape guard — a hand-edited settings row must not crash project creation. */
function isTemplate(value: unknown): value is ProjectTemplateSeed {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ProjectTemplateSeed>;
  return (
    typeof candidate.key === 'string' &&
    candidate.key.length > 0 &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.files)
  );
}

/**
 * Every template offered in the "New project" dialog, ordered as the picker
 * shows them. Falls back to the compiled seeds when the settings row is
 * missing, malformed, or the database is unreachable.
 */
export async function getTemplates(): Promise<ProjectTemplateSeed[]> {
  const stored = await getSetting<unknown>(PROJECT_TEMPLATES_SETTING_KEY, null);

  if (Array.isArray(stored)) {
    const valid = stored.filter(isTemplate);
    if (valid.length > 0) {
      if (valid.length !== stored.length) {
        log.warn('Some stored project templates were malformed and were skipped', {
          stored: stored.length,
          used: valid.length,
        });
      }
      return [...valid].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
    }
    log.warn(
      'The project.templates setting held no usable entries — using the built-in seeds.',
    );
  }

  return [...PROJECT_TEMPLATE_SEEDS].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

export async function getTemplate(key: string): Promise<ProjectTemplateSeed | null> {
  const templates = await getTemplates();
  return templates.find((template) => template.key === key) ?? null;
}

/** Keys accepted by `POST /api/projects` — used to build the Zod enum at runtime. */
export async function getTemplateKeys(): Promise<string[]> {
  return (await getTemplates()).map((template) => template.key);
}

export type ScaffoldResult = {
  template: ProjectTemplateSeed | null;
  filesCreated: number;
  /** Paths the template declared that were rejected as unsafe. */
  skipped: string[];
};

/**
 * Writes a template's files into a project's workspace.
 *
 * Paths go through `normalizeWorkspacePath` even though templates are
 * operator-authored: the settings row is editable at runtime, and a scaffold is
 * the one place a bad path would be written without a user in the loop.
 *
 * Existing files win — scaffolding is additive and safe to re-run.
 */
export async function scaffoldProject(
  projectId: string,
  templateKey: string,
): Promise<ScaffoldResult> {
  const template = await getTemplate(templateKey);
  if (!template) {
    log.warn('Unknown project template — the project starts empty', { templateKey, projectId });
    return { template: null, filesCreated: 0, skipped: [] };
  }

  const skipped: string[] = [];
  const now = new Date();

  const values = template.files.flatMap((file) => {
    let path: string;
    try {
      path = normalizeWorkspacePath(file.path);
    } catch {
      skipped.push(file.path);
      return [];
    }

    const content = typeof file.content === 'string' ? file.content : '';
    return [
      {
        id: newId(ID_PREFIX.projectFile),
        projectId,
        path,
        content,
        isDirectory: false,
        isBinary: false,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        contentHash: sha256(content),
        language: languageFor(path),
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
  });

  if (skipped.length > 0) {
    log.warn('Template declared unsafe paths that were not written', { templateKey, skipped });
  }
  if (values.length === 0) return { template, filesCreated: 0, skipped };

  const inserted = await db
    .insert(projectFiles)
    .values(values)
    .onConflictDoNothing({ target: [projectFiles.projectId, projectFiles.path] })
    .returning({ id: projectFiles.id });

  return { template, filesCreated: inserted.length, skipped };
}

/** Removes every file in a project's workspace. Used before re-scaffolding. */
export async function clearProjectFiles(projectId: string): Promise<void> {
  await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
}
