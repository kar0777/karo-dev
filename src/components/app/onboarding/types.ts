import type { RuntimeTargetOption } from '@/components/app/meta';
import type { AgentPermissions } from '@/lib/agent/policy';

export type OnboardingUsage = 'personal' | 'team' | 'evaluating';

export type OnboardingState = {
  usage: OnboardingUsage | null;
  /** `null` means "decide later" — a deliberate answer, not a missing one. */
  planKey: string | null;
  modelId: string | null;
  runtimeTarget: RuntimeTargetOption;
  workerId: string | null;
  projectName: string;
  projectDescription: string;
  template: string;
  permissions: AgentPermissions;
  firstPrompt: string;
};

export type OnboardingStepId =
  'usage' | 'plan' | 'model' | 'runtime' | 'project' | 'template' | 'permissions' | 'prompt';

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  /** Rail caption — what the step is *for*, in three or four words. */
  railHint: string;
  heading: string;
  description: string;
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'usage',
    title: 'How you work',
    railHint: 'Sets the defaults',
    heading: 'How do you want to use Karo?',
    description:
      'This only picks sensible starting defaults — every one of them is editable afterwards.',
  },
  {
    id: 'plan',
    title: 'Plan',
    railHint: 'Quota and limits',
    heading: 'Choose a plan',
    description:
      'Plans bundle weighted tokens and compute hours. Pay-as-you-go bills the same usage from a balance instead.',
  },
  {
    id: 'model',
    title: 'Model',
    railHint: 'Which model answers',
    heading: 'Choose a model',
    description:
      'This becomes the default for new projects. Any conversation can override it without changing the project.',
  },
  {
    id: 'runtime',
    title: 'Runtime',
    railHint: 'Where code runs',
    heading: 'Where should your machines run?',
    description:
      'The agent needs a real Linux machine to read files and run commands. Pick who provides it.',
  },
  {
    id: 'project',
    title: 'First project',
    railHint: 'Name and purpose',
    heading: 'Create your first project',
    description: 'A project holds your files, your conversations and the machine they run on.',
  },
  {
    id: 'template',
    title: 'Template',
    railHint: 'Starting scaffold',
    heading: 'Pick a starter template',
    description:
      'Every template installs and runs on the first command — none of them need fixing before you start.',
  },
  {
    id: 'permissions',
    title: 'Permissions',
    railHint: 'What the agent may do',
    heading: 'Set agent permissions',
    description:
      'These apply to this project. The agent is refused at the tool boundary, not just asked nicely.',
  },
  {
    id: 'prompt',
    title: 'First message',
    railHint: 'Start building',
    heading: 'Send your first message',
    description:
      'Describe what you want. The agent plans, writes files and runs commands on the machine you just chose.',
  },
];
