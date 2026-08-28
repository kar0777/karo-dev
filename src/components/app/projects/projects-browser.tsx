'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { FolderGit2, LayoutGrid, List, Plus, Search, SearchX, X } from 'lucide-react';

import { RUNTIME_TARGET_META, RUNTIME_TARGET_OPTIONS } from '@/components/app/meta';
import { ProjectCard, type ProjectAction } from '@/components/app/projects/project-card';
import { ProjectCreateDialog } from '@/components/app/projects/project-create-dialog';
import type {
  CreateProjectResponse,
  ProjectDraft,
  ProjectView,
} from '@/components/app/projects/types';
import type { ModelOption, TemplateOption, WorkerOption } from '@/components/app/shell-data';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import type { RuntimeTarget } from '@/lib/db/schema';
import { cn, fuzzyScore } from '@/lib/utils';

/**
 * The projects browser.
 *
 * Filtering happens on the client because the whole team's project list is
 * small by construction (plans cap it) and a round trip per keystroke would
 * feel worse than it reads. Mutations go through the API and then refresh the
 * server render, so the list never drifts from the database.
 */

const VIEW_STORAGE_KEY = 'karo.projects.view';

type ViewMode = 'grid' | 'list';
type ArchiveFilter = 'active' | 'archived' | 'all';
type SortMode = 'recent' | 'name' | 'created';

const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recently opened',
  name: 'Name (A–Z)',
  created: 'Newest first',
};

const DEFAULT_VIEW: ViewMode = 'grid';

/**
 * The layout choice is persisted so it survives navigation, which makes it a
 * browser-only value the server cannot know. It is exposed as an external store
 * rather than state seeded by an effect: `useSyncExternalStore` takes a separate
 * server snapshot, so SSR and hydration render the default and the stored value
 * is adopted immediately afterwards — the same sequence the mount effect used to
 * produce, without scheduling state from an effect.
 *
 * `cachedView` is both the in-memory source of truth and a write-through cache.
 * Keeping it means `getSnapshot` does not touch localStorage on every render,
 * and a browser that denies storage (private mode) still switches layouts for
 * the life of the page instead of silently ignoring the control.
 */
let cachedView: ViewMode | null = null;
const viewListeners = new Set<() => void>();

function readStoredView(): ViewMode {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'grid' || stored === 'list') return stored;
  } catch {
    /* storage unavailable — the default is fine */
  }
  return DEFAULT_VIEW;
}

function getViewSnapshot(): ViewMode {
  cachedView ??= readStoredView();
  return cachedView;
}

function getServerViewSnapshot(): ViewMode {
  return DEFAULT_VIEW;
}

function subscribeView(onStoreChange: () => void) {
  viewListeners.add(onStoreChange);
  // `storage` only fires in the *other* tabs, so when we do hear it ours is the
  // stale copy: drop the cache and let the next snapshot re-read.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== VIEW_STORAGE_KEY) return;
    cachedView = null;
    onStoreChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    viewListeners.delete(onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

function changeView(next: ViewMode) {
  cachedView = next;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  // Notify by hand: this tab never receives its own `storage` event, and a second
  // mounted copy of the browser has to follow along.
  for (const listener of viewListeners) listener();
}

export type ProjectsBrowserProps = {
  projects: readonly ProjectView[];
  templates: readonly TemplateOption[];
  models: readonly ModelOption[];
  workers: readonly WorkerOption[];
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  planName: string;
  maxProjects: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** `?new=1` deep-link, used by the command palette's "New project" action. */
  initialCreateOpen?: boolean;
};

export function ProjectsBrowser({
  projects,
  templates,
  models,
  workers,
  allowOwnServer,
  allowExternalSandbox,
  planName,
  maxProjects,
  canCreate,
  canUpdate,
  canDelete,
  initialCreateOpen = false,
}: ProjectsBrowserProps) {
  const router = useRouter();

  const view = React.useSyncExternalStore(
    subscribeView,
    getViewSnapshot,
    getServerViewSnapshot,
  );
  const [query, setQuery] = React.useState('');
  const [runtimeFilter, setRuntimeFilter] = React.useState<RuntimeTarget | 'all'>('all');
  const [archiveFilter, setArchiveFilter] = React.useState<ArchiveFilter>('active');
  const [sort, setSort] = React.useState<SortMode>('recent');

  const [createOpen, setCreateOpen] = React.useState(initialCreateOpen);
  const [pendingDraft, setPendingDraft] = React.useState<ProjectDraft | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<ProjectView | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<ProjectView | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState('');

  const searchId = React.useId();
  const renameId = React.useId();
  const confirmId = React.useId();

  const templateIconByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const template of templates) map.set(template.key, template.icon);
    return map;
  }, [templates]);

  const visible = React.useMemo(() => {
    const trimmed = query.trim();

    const filtered = projects.filter((project) => {
      if (archiveFilter === 'active' && project.archived) return false;
      if (archiveFilter === 'archived' && !project.archived) return false;
      if (runtimeFilter !== 'all' && project.runtimeTarget !== runtimeFilter) return false;
      if (!trimmed) return true;
      return (
        fuzzyScore(trimmed, project.name) >= 0 ||
        fuzzyScore(trimmed, project.description) >= 0 ||
        fuzzyScore(trimmed, project.slug) >= 0
      );
    });

    if (trimmed) {
      return [...filtered].sort(
        (a, b) => fuzzyScore(trimmed, b.name) - fuzzyScore(trimmed, a.name),
      );
    }

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
  }, [archiveFilter, projects, query, runtimeFilter, sort]);

  const filtersActive =
    query.trim().length > 0 || runtimeFilter !== 'all' || archiveFilter !== 'active';

  function resetFilters() {
    setQuery('');
    setRuntimeFilter('all');
    setArchiveFilter('active');
  }

  /* ---------------- mutations ---------------- */

  async function runMutation(project: ProjectView, work: () => Promise<void>, success: string) {
    setBusyId(project.id);
    try {
      await work();
      toast.success(success);
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusyId(null);
    }
  }

  function handleAction(action: ProjectAction, project: ProjectView) {
    if (action === 'rename') {
      setRenameValue(project.name);
      setRenameError(null);
      setRenaming(project);
      return;
    }
    if (action === 'delete') {
      setDeleteConfirm('');
      setDeleting(project);
      return;
    }
    if (action === 'duplicate') {
      void runMutation(
        project,
        async () => {
          await apiFetch<CreateProjectResponse>('/api/projects', {
            json: {
              name: `${project.name} copy`,
              description: project.description || undefined,
              template: project.template,
              runtimeTarget: project.runtimeTarget,
              workerId: project.workerId ?? undefined,
              modelId: project.defaultModelId ?? undefined,
              agentMode: project.defaultAgentMode,
              shell: project.defaultShell,
            },
          });
        },
        `Duplicated “${project.name}”. Files are not copied — the template is re-scaffolded.`,
      );
      return;
    }

    const archived = action === 'archive';
    void runMutation(
      project,
      async () => {
        await apiFetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          json: { archived },
        });
      },
      archived
        ? `Archived “${project.name}”. Its sandbox will be released on the next sweep.`
        : `Restored “${project.name}”.`,
    );
  }

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const project = renaming;
    if (!project) return;

    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('A project needs a name.');
      return;
    }
    if (trimmed === project.name) {
      setRenaming(null);
      return;
    }

    setRenaming(null);
    await runMutation(
      project,
      async () => {
        await apiFetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          json: { name: trimmed },
        });
      },
      `Renamed to “${trimmed}”.`,
    );
  }

  async function submitDelete() {
    const project = deleting;
    if (!project) return;
    setDeleting(null);
    await runMutation(
      project,
      async () => {
        await apiFetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      },
      `Deleted “${project.name}” and everything in it.`,
    );
  }

  /* ---------------- render ---------------- */

  const atProjectLimit = projects.filter((p) => !p.archived).length >= maxProjects;

  const createButton = (
    <Button
      type="button"
      size="sm"
      iconLeft={<Plus />}
      onClick={() => setCreateOpen(true)}
      disabled={!canCreate || atProjectLimit}
      title={
        !canCreate
          ? 'Your role cannot create projects.'
          : atProjectLimit
            ? `${planName} allows ${maxProjects} active projects. Archive one or upgrade.`
            : undefined
      }
    >
      New project
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <label htmlFor={searchId} className="sr-only">
            Search projects
          </label>
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="Search by name, description or slug"
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={runtimeFilter}
            onValueChange={(value) => setRuntimeFilter(value as RuntimeTarget | 'all')}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Filter by runtime target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All runtimes</SelectItem>
              {RUNTIME_TARGET_OPTIONS.map((target) => (
                <SelectItem key={target} value={target}>
                  {RUNTIME_TARGET_META[target].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <SegmentedControl
            size="sm"
            aria-label="Filter by archived state"
            value={archiveFilter}
            onValueChange={(value) => setArchiveFilter(value as ArchiveFilter)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' },
            ]}
          />

          <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
            <SelectTrigger size="sm" className="w-44" aria-label="Sort projects">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {SORT_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <SegmentedControl
            size="sm"
            aria-label="Layout"
            value={view}
            onValueChange={(value) => changeView(value as ViewMode)}
            options={[
              { value: 'grid', label: '', icon: LayoutGrid, title: 'Grid' },
              { value: 'list', label: '', icon: List, title: 'List' },
            ]}
          />

          {createButton}
        </div>
      </div>

      {atProjectLimit && canCreate ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-warning-soft-fg">
          {planName} includes {maxProjects} active projects and you are using all of them.
          Archive one you have finished with, or upgrade for more headroom.
        </p>
      ) : null}

      {visible.length === 0 && !pendingDraft ? (
        filtersActive ? (
          <EmptyState
            icon={SearchX}
            title="No projects match those filters"
            description="Loosen the search or clear the filters to see the rest of the team's work."
            action={
              <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="A project is a workspace plus the Linux machine it runs on. Start from a template — every one of them builds and runs on the first command."
            action={createButton}
          />
        )
      ) : view === 'grid' ? (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {pendingDraft ? (
            <li>
              <PendingCard draft={pendingDraft} />
            </li>
          ) : null}
          {visible.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                templateIconName={templateIconByKey.get(project.template)}
                view="grid"
                canUpdate={canUpdate}
                canDelete={canDelete}
                busy={busyId === project.id}
                onAction={handleAction}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {pendingDraft ? <PendingCard draft={pendingDraft} view="list" /> : null}
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              templateIconName={templateIconByKey.get(project.template)}
              view="list"
              canUpdate={canUpdate}
              canDelete={canDelete}
              busy={busyId === project.id}
              onAction={handleAction}
            />
          ))}
        </div>
      )}

      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        models={models}
        workers={workers}
        allowOwnServer={allowOwnServer}
        allowExternalSandbox={allowExternalSandbox}
        planName={planName}
        onCreating={setPendingDraft}
        onCreateFailed={() => setPendingDraft(null)}
      />

      {/* Rename */}
      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              The workspace path and existing conversations are untouched — only the display
              name changes.
            </DialogDescription>
          </DialogHeader>
          <form id="rename-project-form" onSubmit={submitRename}>
            <Field>
              <FieldLabel htmlFor={renameId} required>
                Name
              </FieldLabel>
              <Input
                id={renameId}
                value={renameValue}
                autoFocus
                maxLength={80}
                aria-invalid={renameError ? true : undefined}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  if (renameError) setRenameError(null);
                }}
              />
              {renameError ? <FieldError>{renameError}</FieldError> : null}
            </Field>
          </form>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" form="rename-project-form">
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              This removes the workspace files, every conversation, the agent-run history and
              any sandbox attached to it. It cannot be undone. Archiving keeps all of that and
              just hides the project.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={confirmId}>
              Type <span className="font-mono text-[12px]">{deleting?.name}</span> to confirm
            </FieldLabel>
            <Input
              id={confirmId}
              value={deleteConfirm}
              autoComplete="off"
              onChange={(event) => setDeleteConfirm(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const project = deleting;
                setDeleting(null);
                if (project) handleAction('archive', project);
              }}
            >
              Archive instead
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={deleteConfirm.trim() !== deleting?.name}
              onClick={() => void submitDelete()}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PendingCard({ draft, view = 'grid' }: { draft: ProjectDraft; view?: ViewMode }) {
  const runtime = RUNTIME_TARGET_META[draft.runtimeTarget];

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-line bg-surface',
        view === 'grid'
          ? 'h-full rounded-lg border border-dashed p-3.5'
          : 'border-b px-3 py-2.5',
      )}
      aria-live="polite"
    >
      <Spinner size="sm" label={null} className="text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg">{draft.name}</p>
        <p className="truncate text-[11.5px] text-subtle">
          Creating on {runtime.label} — scaffolding {draft.template}…
        </p>
      </div>
      <X className="size-4 text-transparent" aria-hidden="true" />
    </div>
  );
}
