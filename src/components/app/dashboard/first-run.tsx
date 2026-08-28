'use client';

import * as React from 'react';

import { ArrowRight, Plus } from 'lucide-react';

import { templateIcon } from '@/components/app/meta';
import { ProjectCreateDialog } from '@/components/app/projects/project-create-dialog';
import type { ModelOption, TemplateOption, WorkerOption } from '@/components/app/shell-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * What a brand-new account sees.
 *
 * A blank dashboard with a single button is a dead end. Showing the templates
 * up front turns "what do I do now?" into "which of these do I want?", and the
 * card the user clicks is the one the dialog opens with.
 */
export type FirstRunProps = {
  templates: readonly TemplateOption[];
  models: readonly ModelOption[];
  workers: readonly WorkerOption[];
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  planName: string;
  firstName: string;
};

export function FirstRun({
  templates,
  models,
  workers,
  allowOwnServer,
  allowExternalSandbox,
  planName,
  firstName,
}: FirstRunProps) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string | undefined>(undefined);

  function start(templateKey?: string) {
    setSelected(templateKey);
    setOpen(true);
  }

  return (
    <>
      <Card className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="karo-lattice karo-lattice-fade pointer-events-none absolute inset-0 opacity-40"
        />
        <CardContent className="relative p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-base font-semibold text-fg">
                Create your first project{firstName ? `, ${firstName}` : ''}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                A project is a workspace and a Linux machine to run it on. Pick a starter below
                — each one installs and runs on the first command — then describe what you want
                in chat and the agent takes it from there.
              </p>
            </div>
            <Button type="button" iconLeft={<Plus />} onClick={() => start()}>
              New project
            </Button>
          </div>

          <ul className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => {
              const Icon = templateIcon(template.icon);
              return (
                <li key={template.key}>
                  <button
                    type="button"
                    onClick={() => start(template.key)}
                    className="group flex h-full w-full flex-col gap-1.5 rounded-md border border-line bg-surface p-3 text-left transition-[border-color,background-color] duration-150 ease-[var(--k-ease)] hover:border-line-strong hover:bg-surface-2"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="flex-1 truncate text-[13px] font-medium text-fg">
                        {template.name}
                      </span>
                      <ArrowRight
                        className="size-3.5 shrink-0 text-subtle transition-transform duration-150 ease-[var(--k-ease)] group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="karo-truncate-2 text-[12px] leading-snug text-muted">
                      {template.description}
                    </span>
                    <span className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                      <Badge variant="outline" size="sm">
                        {template.language}
                      </Badge>
                      {template.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="neutral" size="sm">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <ProjectCreateDialog
        open={open}
        onOpenChange={setOpen}
        templates={templates}
        models={models}
        workers={workers}
        allowOwnServer={allowOwnServer}
        allowExternalSandbox={allowExternalSandbox}
        planName={planName}
        defaultTemplate={selected}
      />
    </>
  );
}
