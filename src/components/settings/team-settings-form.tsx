'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';

import {
  AVATAR_COLORS,
  AVATAR_COLOR_CLASSES,
  AVATAR_COLOR_LABELS,
  normalizeAvatarColor,
  type AvatarColor,
} from '@/lib/account/preferences';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn, initials, slugify } from '@/lib/utils';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  InputAddon,
  InputGroup,
  toast,
} from '@/components/ui';

export type TeamSettingsFormProps = {
  initial: { name: string; slug: string; avatarColor: string };
  appUrl: string;
  canEdit: boolean;
};

export function TeamSettingsForm({ initial, appUrl, canEdit }: TeamSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState(initial.name);
  const [slug, setSlug] = React.useState(initial.slug);
  const [avatarColor, setAvatarColor] = React.useState<AvatarColor>(
    normalizeAvatarColor(initial.avatarColor),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const normalizedSlug = slugify(slug);
  const dirty =
    name.trim() !== initial.name ||
    normalizedSlug !== initial.slug ||
    avatarColor !== normalizeAvatarColor(initial.avatarColor);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty || !canEdit) return;

    if (!name.trim()) {
      setError('Give the team a name.');
      return;
    }
    if (normalizedSlug.length < 2) {
      setError('The handle needs at least two characters — letters, numbers or hyphens.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await apiFetch('/api/team', {
        method: 'PATCH',
        json: { name: name.trim(), slug: normalizedSlug, avatarColor },
      });
      toast.success('Team settings saved');
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Team settings</CardTitle>
          <CardDescription>
            {canEdit
              ? 'How the team appears across Karo, and the handle used in its URLs.'
              : 'Only owners and admins can change these. Ask one of them if something is wrong.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field disabled={!canEdit}>
              <FieldLabel htmlFor="team-name" required>
                Team name
              </FieldLabel>
              <Input
                id="team-name"
                value={name}
                maxLength={60}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldHint>Shown in the workspace switcher and on invitations.</FieldHint>
            </Field>

            <Field disabled={!canEdit}>
              <FieldLabel htmlFor="team-slug" required>
                Handle
              </FieldLabel>
              <InputGroup>
                <InputAddon>{appUrl.replace(/^https?:\/\//, '')}/</InputAddon>
                <Input
                  id="team-slug"
                  value={slug}
                  mono
                  maxLength={40}
                  disabled={!canEdit}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </InputGroup>
              <FieldHint>
                {normalizedSlug === slug
                  ? 'Unique across Karo. Lower-case letters, numbers and hyphens.'
                  : `Will be saved as “${normalizedSlug}”.`}
              </FieldHint>
            </Field>
          </div>

          <fieldset disabled={!canEdit}>
            <legend className="mb-2 text-[13px] font-medium text-fg">Team colour</legend>
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold',
                  AVATAR_COLOR_CLASSES[avatarColor].surface,
                )}
              >
                {initials(name || 'Team')}
              </span>
              <div
                className="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-label="Team colour"
              >
                {AVATAR_COLORS.map((color) => {
                  const selected = color === avatarColor;
                  return (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={AVATAR_COLOR_LABELS[color]}
                      title={AVATAR_COLOR_LABELS[color]}
                      disabled={!canEdit}
                      onClick={() => setAvatarColor(color)}
                      className={cn(
                        'size-7 rounded-md border transition-transform duration-150 ease-[var(--k-ease)] disabled:opacity-55',
                        AVATAR_COLOR_CLASSES[color].swatch,
                        selected
                          ? 'border-fg scale-105 ring-2 ring-ring ring-offset-2 ring-offset-surface'
                          : 'border-line hover:scale-105',
                      )}
                    />
                  );
                })}
              </div>
            </div>
          </fieldset>

          {error ? <FieldError>{error}</FieldError> : null}
        </CardContent>

        {canEdit ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            <span aria-live="polite" className="mr-auto text-[12px] text-subtle">
              {dirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            <Button type="submit" loading={saving} disabled={!dirty} iconLeft={<Save />}>
              Save team
            </Button>
          </div>
        ) : null}
      </Card>
    </form>
  );
}
