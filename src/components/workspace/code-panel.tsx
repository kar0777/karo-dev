'use client';

import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { ChevronRight, Eye, FileCode, Save, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatBytes } from '@/lib/utils';

import { fileIconFor, isBinaryPath, languageForPath } from './icons';
import { defineKaroMonacoThemes, KARO_THEME_DARK, KARO_THEME_LIGHT } from './monaco-theme';
import { useWorkspace } from './workspace-context';

/**
 * The Code tab.
 *
 * Monaco is loaded lazily by `@monaco-editor/react`; until it arrives the pane
 * shows a skeleton rather than an empty box, because a blank editor reads as a
 * broken editor.
 */

function EditorSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-hidden="true">
      {[92, 64, 78, 40, 86, 54, 70].map((width, index) => (
        <Skeleton key={index} className="h-3 rounded-sm" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

export function CodePanel() {
  const {
    openFiles,
    activeFilePath,
    setActiveFilePath,
    closeFile,
    updateFileDraft,
    saveFile,
    data,
    notify,
  } = useWorkspace();

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const monacoRef = React.useRef<Monaco | null>(null);
  const [saving, setSaving] = React.useState(false);

  const active = openFiles.find((file) => file.path === activeFilePath) ?? null;
  const canWrite = data.capabilities.canWriteFiles;
  const dirty = active ? active.content !== active.savedContent : false;

  // Re-register on theme flips so the editor never lags a theme behind.
  React.useEffect(() => {
    if (monacoRef.current) defineKaroMonacoThemes(monacoRef.current, isDark);
  }, [isDark]);

  const save = React.useCallback(async () => {
    if (!active || !canWrite) return;
    setSaving(true);
    try {
      await saveFile(active.path, active.content);
      notify('success', `Saved ${active.path}`);
    } catch (error) {
      notify(
        'error',
        `Could not save ${active.path}`,
        error instanceof Error ? error.message : 'Try again in a moment.',
      );
    } finally {
      setSaving(false);
    }
  }, [active, canWrite, notify, saveFile]);

  const handleMount = React.useCallback<OnMount>(
    (editor, monaco) => {
      monacoRef.current = monaco;
      defineKaroMonacoThemes(monaco, isDark);
      monaco.editor.setTheme(isDark ? KARO_THEME_DARK : KARO_THEME_LIGHT);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void save();
      });
    },
    [isDark, save],
  );

  if (openFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={FileCode}
          title="No file open"
          description="Pick a file in the explorer, or ask the agent to create one. Changes save with Ctrl/Cmd + S."
        />
      </div>
    );
  }

  const segments = active ? active.path.split('/') : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Open files"
        className="karo-no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-1"
      >
        {openFiles.map((file) => {
          const Icon = fileIconFor(file.path);
          const isActive = file.path === activeFilePath;
          const isDirty = file.content !== file.savedContent;
          return (
            <div
              key={file.path}
              className={cn(
                'group/tab flex shrink-0 items-center gap-1.5 border-b-2 py-1.5 pr-1 pl-2',
                isActive
                  ? 'border-primary bg-surface-2 text-fg'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveFilePath(file.path)}
                className="flex items-center gap-1.5 rounded-sm text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
                <span className="max-w-44 truncate">{file.path.split('/').pop()}</span>
                {isDirty ? (
                  <span
                    aria-label="Unsaved changes"
                    className="size-1.5 shrink-0 rounded-full bg-ember"
                  />
                ) : null}
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
                aria-label={`Close ${file.path}`}
                onClick={() => closeFile(file.path)}
              >
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {active ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface-2 px-3 py-1">
            <nav aria-label="File path" className="flex min-w-0 flex-1 items-center gap-0.5">
              {segments.map((segment, index) => (
                <React.Fragment key={`${segment}-${index}`}>
                  {index > 0 ? (
                    <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-subtle" />
                  ) : null}
                  <span
                    className={cn(
                      'truncate font-mono text-[11.5px]',
                      index === segments.length - 1 ? 'text-fg' : 'text-subtle',
                    )}
                  >
                    {segment}
                  </span>
                </React.Fragment>
              ))}
            </nav>
            <span className="karo-numeric shrink-0 text-[11px] text-subtle">
              {formatBytes(new Blob([active.content]).size)} · {active.language}
            </span>
            <Button
              size="xs"
              variant={dirty ? 'primary' : 'ghost'}
              iconLeft={<Save />}
              loading={saving}
              disabled={!canWrite || !dirty}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>

          {!canWrite ? (
            <Alert variant="warning" icon={Eye} className="m-2">
              <AlertTitle>Read-only</AlertTitle>
              <AlertDescription>
                Your role can view this project but not change its files. Ask a team admin for
                the Developer role to edit and save.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="karo-monaco min-h-0 flex-1">
            {active.error ? (
              <ErrorState
                title="Could not open this file"
                description={active.error}
                code={active.path}
                retry={() => setActiveFilePath(active.path)}
              />
            ) : active.loading ? (
              <EditorSkeleton />
            ) : isBinaryPath(active.path) ? (
              <EmptyState
                icon={FileCode}
                title="Binary file"
                description="Karo does not open binary files in the editor. Use the terminal if you need to inspect it."
              />
            ) : (
              <Editor
                key={active.path}
                path={active.path}
                language={active.language || languageForPath(active.path)}
                value={active.content}
                theme={isDark ? KARO_THEME_DARK : KARO_THEME_LIGHT}
                loading={<EditorSkeleton />}
                onMount={handleMount}
                onChange={(value) => updateFileDraft(active.path, value ?? '')}
                options={{
                  readOnly: !canWrite,
                  fontSize: 13,
                  lineHeight: 20,
                  fontFamily:
                    'var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                  fontLigatures: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  renderLineHighlight: 'all',
                  cursorBlinking: 'smooth',
                  padding: { top: 12, bottom: 12 },
                  tabSize: 2,
                  automaticLayout: true,
                  bracketPairColorization: { enabled: true },
                  guides: { indentation: true, bracketPairs: false },
                  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                  overviewRulerBorder: false,
                  wordWrap: 'off',
                }}
              />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
