'use client';

import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { skillDocumentSchema } from '@/lib/extensions/schemas';

/**
 * Import a skill from a pasted or uploaded document.
 *
 * The same Zod schema the API uses runs here first, so a malformed file is
 * rejected with field-level messages before a request is made.
 */
export function SkillImportButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [issues, setIssues] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  /**
   * Every open/close goes through here so the draft and its validation messages
   * move in the same update as `open`. They used to be cleared by an effect
   * watching `open`, which is a render later than the close it reacts to.
   */
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setText('');
      setIssues([]);
    }
  }

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setText(await file.text());
    setIssues([]);
  }

  function validate(): unknown | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setIssues([
        'The text is not valid JSON. Paste the whole file, including the outer braces.',
      ]);
      return null;
    }

    const result = skillDocumentSchema.safeParse(parsed);
    if (!result.success) {
      setIssues(
        result.error.issues.map((issue) =>
          issue.path.length > 0
            ? `${issue.path.map(String).join('.')}: ${issue.message}`
            : issue.message,
        ),
      );
      return null;
    }

    setIssues([]);
    return result.data;
  }

  async function submit() {
    const document = validate();
    if (document === null) return;

    setBusy(true);
    try {
      await apiFetch('/api/skills/import', { method: 'POST', json: { skill: document } });
      toast.success('Skill imported', {
        description: 'It is in your catalogue now — install it to start using it.',
      });
      changeOpen(false);
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconLeft={<Upload />}
        disabled={disabled}
        onClick={() => changeOpen(true)}
      >
        Import
      </Button>

      <Dialog open={open} onOpenChange={busy ? undefined : changeOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import a skill</DialogTitle>
            <DialogDescription>
              Paste an exported Karo skill document, or choose a `.json` file. It is validated
              before anything is saved.
            </DialogDescription>
          </DialogHeader>

          <Field disabled={busy}>
            <FieldLabel htmlFor="skill-import-json" required>
              Skill document
            </FieldLabel>
            <Textarea
              id="skill-import-json"
              mono
              rows={12}
              value={text}
              placeholder={
                '{\n  "name": "Release notes",\n  "description": "…",\n  "instructions": "…"\n}'
              }
              onChange={(event) => {
                setText(event.target.value);
                setIssues([]);
              }}
            />
            <FieldHint>
              Exported skills come from the Installed tab. The document never contains a secret
              — only the field names your team fills in.
            </FieldHint>
            {issues.length > 0 ? (
              <FieldError>
                <span className="block">This document cannot be imported yet:</span>
                <ul className="mt-1 list-disc pl-4">
                  {issues.slice(0, 6).map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </FieldError>
            ) : null}
          </Field>

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void pickFile(event)}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Choose a file…
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              loading={busy}
              disabled={text.trim() === ''}
              onClick={() => void submit()}
            >
              Import skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
