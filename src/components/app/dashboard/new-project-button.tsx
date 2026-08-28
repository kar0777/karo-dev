'use client';

import * as React from 'react';

import { Plus } from 'lucide-react';

import { ProjectCreateDialog } from '@/components/app/projects/project-create-dialog';
import type { ModelOption, TemplateOption, WorkerOption } from '@/components/app/shell-data';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * "New project" button plus the dialog it opens.
 *
 * The dashboard and the first-run empty state both need it, and both need the
 * dialog's data, so button and dialog travel together rather than each caller
 * re-wiring the open state.
 */
export type NewProjectButtonProps = {
  templates: readonly TemplateOption[];
  models: readonly ModelOption[];
  workers: readonly WorkerOption[];
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  planName: string;
  defaultTemplate?: string;
  label?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
};

export function NewProjectButton({
  templates,
  models,
  workers,
  allowOwnServer,
  allowExternalSandbox,
  planName,
  defaultTemplate,
  label = 'New project',
  size = 'sm',
  variant = 'primary',
  className,
}: NewProjectButtonProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        iconLeft={<Plus />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <ProjectCreateDialog
        open={open}
        onOpenChange={setOpen}
        templates={templates}
        models={models}
        workers={workers}
        allowOwnServer={allowOwnServer}
        allowExternalSandbox={allowExternalSandbox}
        planName={planName}
        defaultTemplate={defaultTemplate}
      />
    </>
  );
}
