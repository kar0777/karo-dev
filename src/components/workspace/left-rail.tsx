'use client';

import {
  Check,
  ChevronsUpDown,
  CircleDashed,
  CircleX,
  FilePlus,
  FolderPlus,
  GitBranch,
  ListChecks,
  RefreshCw,
  Search,
  SkipForward,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn, pluralize } from '@/lib/utils';

import { DiffStat } from './diff-view';
import { FileActionDialog, type FileAction } from './file-dialog';
import { FileTree } from './file-tree';
import { isBinaryPath } from './icons';
import type { PlanStepStatus, WorkspaceGitStatus } from './types';
import { useWorkspace } from './workspace-context';

/**
 * The left rail: where you are, what is in the project, what changed and what
 * the agent is doing right now.
 */

const MAX_SCANNED_FILES = 240;
const SEARCH_CONCURRENCY = 8;

type SearchHit = { path: string; lines: Array<{ number: number; text: string }> };

function useContentSearch() {
  const { files, readFile } = useWorkspace();
  const cache = React.useRef(new Map<string, string>());

  const [hits, setHits] = React.useState<SearchHit[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);

  const search = React.useCallback(
    async (query: string) => {
      const needle = query.trim();
      if (!needle) {
        setHits(null);
        return;
      }
      setBusy(true);
      setError(null);

      const candidates = files
        .filter((file) => !file.isDirectory && !isBinaryPath(file.path))
        .slice(0, MAX_SCANNED_FILES);
      setTruncated(
        files.filter((file) => !file.isDirectory && !isBinaryPath(file.path)).length >
          candidates.length,
      );

      const lower = needle.toLowerCase();
      const found: SearchHit[] = [];
      let cursor = 0;

      const worker = async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          const file = candidates[index];
          if (!file) return;
          try {
            let content = cache.current.get(file.path);
            if (content === undefined) {
              content = (await readFile(file.path)).content;
              cache.current.set(file.path, content);
            }
            if (!content.toLowerCase().includes(lower)) continue;
            const lines: SearchHit['lines'] = [];
            content.split('\n').forEach((text, lineIndex) => {
              if (lines.length < 5 && text.toLowerCase().includes(lower)) {
                lines.push({ number: lineIndex + 1, text: text.trim().slice(0, 200) });
              }
            });
            found.push({ path: file.path, lines });
          } catch {
            // A single unreadable file must not abort the whole search.
          }
        }
      };

      try {
        await Promise.all(
          Array.from({ length: Math.min(SEARCH_CONCURRENCY, candidates.length) }, worker),
        );
        found.sort((a, b) => a.path.localeCompare(b.path));
        setHits(found);
      } catch (caught) {
        setError(describeError(caught).message);
      } finally {
        setBusy(false);
      }
    },
    [files, readFile],
  );

  const reset = React.useCallback(() => {
    setHits(null);
    setError(null);
  }, []);

  return { hits, busy, error, truncated, search, reset };
}

function ProjectSwitcher() {
  const { data } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between px-2"
          iconRight={<ChevronsUpDown className="size-3.5 text-subtle" />}
        >
          <span className="truncate text-[12.5px] font-medium text-fg">
            {data.project.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {data.projects.map((project) => (
          <DropdownMenuItem key={project.id} asChild>
            <Link href={`/app/projects/${project.id}`}>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {project.id === data.project.id ? (
                <Check className="size-3.5 text-primary" aria-hidden="true" />
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/projects">All projects</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const GIT_TONE: Record<string, string> = {
  added: 'text-success',
  modified: 'text-info',
  deleted: 'text-danger',
  renamed: 'text-warning',
  untracked: 'text-subtle',
};

function GitSection() {
  const { data, openFile, notify } = useWorkspace();
  const [git, setGit] = React.useState<WorkspaceGitStatus>(data.git);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    setBusy(true);
    void apiFetch<{ git?: WorkspaceGitStatus } & Partial<WorkspaceGitStatus>>(
      `/api/projects/${data.project.id}/git`,
    )
      .then((payload) => {
        const next = payload.git ?? (payload as WorkspaceGitStatus);
        if (next && Array.isArray(next.files)) setGit(next);
      })
      .catch((error: unknown) =>
        notify('warning', 'Could not read git status', describeError(error).message),
      )
      .finally(() => setBusy(false));
  }, [data.project.id, notify]);

  return (
    <section aria-label="Git status" className="border-t border-line">
      <header className="flex items-center gap-1.5 px-2 py-1.5">
        <GitBranch aria-hidden="true" className="size-3.5 text-subtle" />
        <span className="truncate text-[11px] font-medium tracking-wide text-subtle uppercase">
          {git.branch}
        </span>
        {git.ahead > 0 ? (
          <Badge variant="primary" size="sm">
            ↑{git.ahead}
          </Badge>
        ) : null}
        {git.behind > 0 ? (
          <Badge variant="neutral" size="sm">
            ↓{git.behind}
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-5"
          aria-label="Refresh git status"
          onClick={refresh}
        >
          {busy ? <Spinner size="xs" label={null} /> : <RefreshCw className="size-3" />}
        </Button>
      </header>

      {git.files.length === 0 ? (
        <p className="px-2 pb-2 text-[11.5px] text-subtle">
          Working tree clean on {git.branch}.
        </p>
      ) : (
        <ul className="pb-1.5">
          {git.files.slice(0, 40).map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => openFile(file.path)}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-[3px] text-left text-[12px] text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn('w-3 shrink-0 font-mono text-[11px]', GIT_TONE[file.status])}
                >
                  {file.status.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{file.path}</span>
                <DiffStat
                  additions={file.additions}
                  deletions={file.deletions}
                  className="ml-auto shrink-0"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STEP_ICON: Record<PlanStepStatus, React.ReactNode> = {
  pending: <CircleDashed className="size-3.5 text-subtle" aria-hidden="true" />,
  active: <Spinner size="xs" label={null} className="text-primary" />,
  done: <Check className="size-3.5 text-primary" aria-hidden="true" />,
  skipped: <SkipForward className="size-3.5 text-subtle" aria-hidden="true" />,
  failed: <CircleX className="size-3.5 text-danger" aria-hidden="true" />,
};

function TaskSection() {
  const { runs, activeRunId, setTab } = useWorkspace();
  const run = runs.find((candidate) => candidate.id === activeRunId) ?? runs[0] ?? null;
  const steps = run?.steps ?? [];

  return (
    <section aria-label="Agent tasks" className="border-t border-line">
      <header className="flex items-center gap-1.5 px-2 py-1.5">
        <ListChecks aria-hidden="true" className="size-3.5 text-subtle" />
        <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">
          Agent plan
        </span>
        {steps.length > 0 ? (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setTab('tasks')}>
            Open
          </Button>
        ) : null}
      </header>

      {steps.length === 0 ? (
        <p className="px-2 pb-2 text-[11.5px] text-subtle">
          No plan yet. Ask in Plan or Auto mode and the steps will appear here as they run.
        </p>
      ) : (
        <ol className="space-y-0.5 px-2 pb-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-1.5 text-[12px]">
              <span className="mt-px shrink-0">{STEP_ICON[step.status]}</span>
              <span
                className={cn(
                  'min-w-0 flex-1',
                  step.status === 'done' ? 'text-subtle line-through' : 'text-muted',
                  step.status === 'active' && 'font-medium text-fg',
                )}
              >
                {step.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function LeftRail() {
  const { data, files, filesLoading, filesError, refreshFiles, fileSearchNonce, openFile } =
    useWorkspace();

  const [query, setQuery] = React.useState('');
  const [action, setAction] = React.useState<FileAction | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const { hits, busy, error, truncated, search, reset } = useContentSearch();

  React.useEffect(() => {
    if (fileSearchNonce === 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [fileSearchNonce]);

  const pathMatches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const matched = files.filter((file) => file.path.toLowerCase().includes(needle));
    if (matched.length === 0) return new Set<string>();
    const paths = new Set<string>();
    for (const file of matched) paths.add(file.path);
    return paths;
  }, [files, query]);

  const filterPaths = hits ? new Set(hits.map((hit) => hit.path)) : pathMatches;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-line px-1.5 py-1.5">
        <ProjectSwitcher />
      </div>

      <div className="border-b border-line px-2 py-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle"
          />
          <Input
            ref={searchRef}
            inputSize="sm"
            value={query}
            placeholder="Find in files"
            aria-label="Search files by name, press Enter to search contents"
            className="pr-7 pl-7"
            onChange={(event) => {
              setQuery(event.target.value);
              if (hits) reset();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search(query);
              if (event.key === 'Escape') {
                setQuery('');
                reset();
              }
            }}
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                reset();
              }}
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-[10.5px] text-subtle">
          {busy
            ? 'Searching file contents…'
            : hits
              ? `${hits.length} ${pluralize(hits.length, 'file')} contain “${query.trim()}”${truncated ? ` (first ${MAX_SCANNED_FILES} files)` : ''}`
              : 'Filters by name. Press Enter to search inside files.'}
        </p>
        {error ? <p className="mt-1 text-[11px] text-danger">{error}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filesError ? (
          <div className="px-3 py-4">
            <p className="text-[12px] text-danger">{filesError}</p>
            <Button variant="secondary" size="xs" className="mt-2" onClick={refreshFiles}>
              Try again
            </Button>
          </div>
        ) : filesLoading && files.length === 0 ? (
          <div className="space-y-1.5 px-2 py-2" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="karo-skeleton h-3 rounded-sm" />
            ))}
          </div>
        ) : hits ? (
          <ul className="py-1">
            {hits.map((hit) => (
              <li key={hit.path} className="px-1">
                <button
                  type="button"
                  onClick={() => openFile(hit.path)}
                  className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate font-mono text-[12px] text-fg">
                    {hit.path}
                  </span>
                  {hit.lines.map((line) => (
                    <span
                      key={line.number}
                      className="mt-0.5 block truncate font-mono text-[11px] text-subtle"
                    >
                      <span className="karo-numeric mr-1.5 text-muted">{line.number}</span>
                      {line.text}
                    </span>
                  ))}
                </button>
              </li>
            ))}
            {hits.length === 0 ? (
              <li className="px-3 py-4 text-[12px] text-muted">
                Nothing matched. Try a shorter string, or search by file name instead.
              </li>
            ) : null}
          </ul>
        ) : (
          <FileTree filterPaths={filterPaths} />
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line px-1.5 py-1.5">
        <Button
          variant="ghost"
          size="xs"
          iconLeft={<FilePlus />}
          disabled={!data.capabilities.canWriteFiles}
          onClick={() => setAction({ kind: 'new-file', parent: '' })}
        >
          New file
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconLeft={<FolderPlus />}
          disabled={!data.capabilities.canWriteFiles}
          onClick={() => setAction({ kind: 'new-folder', parent: '' })}
        >
          New folder
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Refresh file tree"
          onClick={refreshFiles}
        >
          {filesLoading ? (
            <Spinner size="xs" label={null} />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
      </div>

      <GitSection />
      <TaskSection />

      <FileActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}
