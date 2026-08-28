'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { MailWarning, Save } from 'lucide-react';

import {
  AVATAR_COLORS,
  AVATAR_COLOR_CLASSES,
  AVATAR_COLOR_LABELS,
  THEME_LABELS,
  THEME_PREFERENCES,
  type AvatarColor,
  type ThemePreference,
} from '@/lib/account/preferences';
import { apiFetch, describeError } from '@/lib/client/api';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n';
import { cn, initials } from '@/lib/utils';
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@/components/ui';

export type ProfileFormProps = {
  initial: {
    name: string;
    email: string;
    emailVerified: boolean;
    avatarColor: AvatarColor;
    locale: Locale;
    theme: ThemePreference;
  };
};

type FieldErrors = Partial<Record<'name' | 'email', string>>;

export function ProfileForm({ initial }: ProfileFormProps) {
  const router = useRouter();
  const { setTheme } = useTheme();

  const [name, setName] = React.useState(initial.name);
  const [email, setEmail] = React.useState(initial.email);
  const [avatarColor, setAvatarColor] = React.useState<AvatarColor>(initial.avatarColor);
  const [locale, setLocale] = React.useState<Locale>(initial.locale);
  const [theme, setThemePreference] = React.useState<ThemePreference>(initial.theme);

  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== initial.email.toLowerCase();
  const dirty =
    name.trim() !== initial.name ||
    emailChanged ||
    avatarColor !== initial.avatarColor ||
    locale !== initial.locale ||
    theme !== initial.theme;

  function handleThemeChange(next: ThemePreference) {
    setThemePreference(next);
    // Apply immediately — a theme switch that waits for a round trip feels broken.
    setTheme(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;

    const nextErrors: FieldErrors = {};
    if (!name.trim()) nextErrors.name = 'Enter the name your teammates will see.';
    if (!email.trim().includes('@')) nextErrors.email = 'Enter a valid email address.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setFormError(null);

    try {
      await apiFetch('/api/settings/profile', {
        method: 'PATCH',
        json: { name: name.trim(), email: email.trim(), avatarColor, locale, theme },
      });

      toast.success(
        emailChanged ? 'Profile saved — check your new inbox' : 'Profile saved',
        emailChanged
          ? { description: `We sent a confirmation link to ${email.trim()}.` }
          : undefined,
      );
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      setFormError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How you appear to the rest of your team, and how Karo talks to you.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-name" required>
                Name
              </FieldLabel>
              <Input
                id="profile-name"
                name="name"
                autoComplete="name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'profile-name-error' : undefined}
              />
              {errors.name ? (
                <FieldError id="profile-name-error">{errors.name}</FieldError>
              ) : (
                <FieldHint>Shown on team rosters, audit entries and agent runs.</FieldHint>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="profile-email" required>
                Email
              </FieldLabel>
              <Input
                id="profile-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                maxLength={254}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'profile-email-error' : 'profile-email-hint'}
              />
              {errors.email ? (
                <FieldError id="profile-email-error">{errors.email}</FieldError>
              ) : (
                <FieldHint id="profile-email-hint">
                  Used for sign-in, quota alerts and invoices.
                </FieldHint>
              )}
            </Field>
          </div>

          {emailChanged ? (
            <Alert variant="warning" icon={<MailWarning />}>
              <AlertTitle>Changing your email needs re-verification</AlertTitle>
              <AlertDescription>
                Saving marks this account unverified and sends a confirmation link to{' '}
                <span className="font-medium text-fg">{email.trim()}</span>. You stay signed in,
                but quota and billing emails go to the new address only after you confirm it.
              </AlertDescription>
            </Alert>
          ) : initial.emailVerified ? null : (
            <Alert variant="info">
              <AlertTitle>This address is not confirmed yet</AlertTitle>
              <AlertDescription>
                Open the link we emailed to {initial.email}. Without it, Karo cannot warn you
                before your quota runs out.
              </AlertDescription>
            </Alert>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-2 text-[13px] font-medium text-fg">Avatar colour</legend>
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold',
                  AVATAR_COLOR_CLASSES[avatarColor].surface,
                )}
              >
                {initials(name || email)}
              </span>
              <div
                className="flex flex-wrap gap-1.5"
                role="radiogroup"
                aria-label="Avatar colour"
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
                      onClick={() => setAvatarColor(color)}
                      className={cn(
                        'size-7 rounded-md border transition-transform duration-150 ease-[var(--k-ease)]',
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
            <FieldHint>
              Used wherever you have no picture — team lists, run history and comments.
            </FieldHint>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-locale">Language</FieldLabel>
              <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                <SelectTrigger id="profile-locale" className="w-full">
                  <SelectValue placeholder="Choose a language" />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {LOCALE_NAMES[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                Interface language. Agent replies follow the language you write in.
              </FieldHint>
            </Field>

            <div className="space-y-1.5">
              <Label htmlFor="profile-theme">Theme</Label>
              <SegmentedControl<ThemePreference>
                id="profile-theme"
                aria-label="Theme"
                value={theme}
                onValueChange={handleThemeChange}
                fullWidth
                options={THEME_PREFERENCES.map((value) => ({
                  value,
                  label: THEME_LABELS[value],
                }))}
              />
              <FieldHint>
                Applies instantly on this device and is saved to your account.
              </FieldHint>
            </div>
          </div>

          {formError ? <FieldError>{formError}</FieldError> : null}
        </CardContent>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span aria-live="polite" className="mr-auto text-[12px] text-subtle">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button type="submit" loading={saving} disabled={!dirty} iconLeft={<Save />}>
            Save profile
          </Button>
        </div>
      </Card>
    </form>
  );
}
