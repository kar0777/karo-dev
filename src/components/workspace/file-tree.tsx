'use client';

import { ChevronRight, EllipsisVertical, Folder, FolderOpen } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

import { FileActionDialog, type FileAction } from './file-dialog';
import { fileIconFor } from './icons';
import type { WorkspaceFileNode } from './types';
import { useWorkspace } from './workspace-context';

/**
 * The project file explorer.
 *
 * Directories are derived from paths rather than trusted to exist as rows: a
 * workspace backed by object storage has no directory entities, and the tree
 * still has to look like a tree.
 */

type TreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  file: WorkspaceFileNode | null;
};

function buildTree(files: readonly WorkspaceFileNode[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDirectory: true, children: [], file: null };
  const index = new Map<string, TreeNode>([['', root]]);

  const ensureDirectory = (path: string): TreeNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parentPath = slash === -1 ? '' : path.slice(0, slash);
    const parent = ensureDirectory(parentPath);
    const node: TreeNode = {
      name: path.slice(slash + 1),
      path,
      isDirectory: true,
      children: [],
      file: null,
    };
    parent.children.push(node);
    index.set(path, node);
    return node;
  };

  for (const file of files) {
    if (!file.path) continue;
    if (file.isDirectory) {
      ensureDirectory(file.path).file = file;
      continue;
    }
    const slash = file.path.lastIndexOf('/');
    const parent = ensureDirectory(slash === -1 ? '' : file.path.slice(0, slash));
    parent.children.push({
      name: file.path.slice(slash + 1),
      path: file.path,
      isDirectory: false,
      children: [],
      file,
    });
  }

  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    node.children.forEach(sort);
  };
  sort(root);

  return root.children;
}

type Row = { node: TreeNode; depth: number };

function flatten(nodes: TreeNode[], expanded: Set<string>, depth = 0): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.isDirectory && expanded.has(node.path)) {
      rows.push(...flatten(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

export function FileTree({ filterPaths }: { filterPaths?: Set<string> | null }) {
  const { files, activeFilePath, openFile, data } = useWorkspace();

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(['src', 'app']));
  const [focusIndex, setFocusIndex] = React.useState(0);
  const [action, setAction] = React.useState<FileAction | null>(null);

  const rowRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const canWrite = data.capabilities.canWriteFiles;

  const visibleFiles = React.useMemo(() => {
    if (!filterPaths) return files;
    return files.filter((file) => filterPaths.has(file.path));
  }, [files, filterPaths]);

  const tree = React.useMemo(() => buildTree(visibleFiles), [visibleFiles]);

  // A filtered tree is useless collapsed — open every directory it contains.
  const effectiveExpanded = React.useMemo(() => {
    if (!filterPaths) return expanded;
    const all = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.isDirectory) {
          all.add(node.path);
          walk(node.children);
        }
      }
    };
    walk(tree);
    return all;
  }, [expanded, filterPaths, tree]);

  const rows = React.useMemo(() => flatten(tree, effectiveExpanded), [effectiveExpanded, tree]);

  const toggle = React.useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  function activate(row: Row) {
    if (row.node.isDirectory) toggle(row.node.path);
    else openFile(row.node.path);
  }

  function parentOf(node: TreeNode): string {
    if (node.isDirectory) return node.path;
    const slash = node.path.lastIndexOf('/');
    return slash === -1 ? '' : node.path.slice(0, slash);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number) {
    const row = rows[index];
    if (!row) return;

    const move = (next: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, next));
      setFocusIndex(clamped);
      rowRefs.current[clamped]?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(rows.length - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.node.isDirectory && !effectiveExpanded.has(row.node.path))
          toggle(row.node.path);
        else move(index + 1);
        break;
      case 'ArrowLeft': {
        event.preventDefault();
        if (row.node.isDirectory && effectiveExpanded.has(row.node.path)) {
          toggle(row.node.path);
          break;
        }
        const parentPath = parentOf(row.node);
        const parentIndex = rows.findIndex((candidate) => candidate.node.path === parentPath);
        if (parentIndex >= 0) move(parentIndex);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(row);
        break;
      case 'Delete':
        if (!canWrite || row.node.isDirectory) break;
        event.preventDefault();
        setAction({ kind: 'delete', path: row.node.path });
        break;
      case 'F2':
        if (!canWrite || row.node.isDirectory) break;
        event.preventDefault();
        setAction({ kind: 'rename', path: row.node.path });
        break;
      default:
        break;
    }
  }

  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-[12px] text-muted">
        {filterPaths
          ? 'No file matches that search.'
          : 'This project has no files yet. Ask the agent to scaffold one, or create a file from the explorer footer.'}
      </p>
    );
  }

  return (
    <>
      <div role="tree" aria-label="Project files" className="py-1">
        {rows.map((row, index) => {
          const { node, depth } = row;
          const open = node.isDirectory && effectiveExpanded.has(node.path);
          const Icon = node.isDirectory ? (open ? FolderOpen : Folder) : fileIconFor(node.path);
          const active = node.path === activeFilePath;
          const pendingKind = node.file?.pendingChangeKind;

          return (
            <div
              key={node.path}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={active}
              aria-expanded={node.isDirectory ? open : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => activate(row)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.currentTarget
                  .querySelector<HTMLButtonElement>('[data-row-menu="true"]')
                  ?.click();
              }}
              className={cn(
                'group/file flex cursor-pointer items-center gap-1.5 rounded-sm py-[3px] pr-1 text-[12.5px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
            >
              {node.isDirectory ? (
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    'size-3 shrink-0 text-subtle transition-transform duration-150',
                    open && 'rotate-90',
                  )}
                />
              ) : (
                <span aria-hidden="true" className="w-3 shrink-0" />
              )}
              <Icon
                aria-hidden="true"
                className={cn(
                  'size-3.5 shrink-0',
                  node.isDirectory ? 'text-primary' : 'text-subtle',
                )}
              />
              <span className="truncate">{node.name}</span>
              {pendingKind ? (
                <span
                  title={`${pendingKind} — awaiting review`}
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-ember"
                >
                  <span className="sr-only">{pendingKind} — awaiting review</span>
                </span>
              ) : null}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-row-menu="true"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      'size-5 shrink-0 opacity-0',
                      'group-hover/file:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
                      pendingKind ? 'ml-1.5' : 'ml-auto',
                    )}
                    aria-label={`Actions for ${node.name}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <EllipsisVertical className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
                  <DropdownMenuItem
                    disabled={!canWrite}
                    onSelect={() => setAction({ kind: 'new-file', parent: parentOf(node) })}
                  >
                    New file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canWrite}
                    onSelect={() => setAction({ kind: 'new-folder', parent: parentOf(node) })}
                  >
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {!node.isDirectory ? (
                    <DropdownMenuItem onSelect={() => openFile(node.path)}>
                      Open in editor
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    disabled={!canWrite || node.isDirectory}
                    onSelect={() => setAction({ kind: 'rename', path: node.path })}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="danger"
                    disabled={!canWrite || node.isDirectory}
                    onSelect={() => setAction({ kind: 'delete', path: node.path })}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>

      <FileActionDialog action={action} onClose={() => setAction(null)} />
    </>
  );
}
