/**
 * Seed catalogue of installable terminal coding agents.
 *
 * Karo never redistributes these tools and never proxies their traffic: every
 * install command points at the vendor's own package registry or installer
 * script, and proprietary tools authenticate with the user's own account or
 * license key inside the terminal. The catalogue only remembers the official
 * commands, the binary to probe, and how the tool expects to be authenticated.
 *
 * `sandbox` targets the Karo sandbox image (Debian 12, Node 22, Python 3);
 * `macos` / `linux` / `windows` are the commands printed for "install on my
 * machine". Admins can edit every field from `/admin/cli-tools`.
 */

export type CliToolSeed = {
  slug: string;
  name: string;
  vendor: string;
  description: string;
  license: string;
  licenseKind: 'free' | 'proprietary';
  licenseUrl?: string;
  docsUrl?: string;
  authKind: 'login' | 'api_key' | 'none';
  authNote?: string;
  apiKeyEnvVar?: string;
  apiKeyProviderKey?: string;
  binName: string;
  versionArg?: string;
  installCommands: { sandbox: string; macos: string; linux: string; windows: string };
  launchCommand: string;
  sortOrder?: number;
};

export const CLI_TOOL_SEEDS: CliToolSeed[] = [
  {
    slug: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    description:
      'Anthropic’s agentic coding tool. Plans, edits and ships code from the terminal with the Claude models.',
    license: 'Proprietary',
    licenseKind: 'proprietary',
    licenseUrl: 'https://www.anthropic.com/legal/commercial-terms',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    authKind: 'login',
    authNote:
      'Run `claude` once and pick “Log in with Claude account”, or attach an ANTHROPIC_API_KEY from your vault.',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    apiKeyProviderKey: 'anthropic',
    binName: 'claude',
    installCommands: {
      sandbox: 'npm install -g @anthropic-ai/claude-code',
      macos: 'npm install -g @anthropic-ai/claude-code',
      linux: 'npm install -g @anthropic-ai/claude-code',
      windows: 'npm install -g @anthropic-ai/claude-code',
    },
    launchCommand: 'claude',
    sortOrder: 10,
  },
  {
    slug: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    description:
      'OpenAI’s open-source coding agent. Signs in with ChatGPT or an OpenAI API key and works on your repo from the shell.',
    license: 'Apache-2.0',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/openai/codex/blob/main/LICENSE',
    docsUrl: 'https://developers.openai.com/codex/cli/',
    authKind: 'login',
    authNote:
      'Run `codex` once and choose “Sign in with ChatGPT”, or attach an OPENAI_API_KEY from your vault.',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    apiKeyProviderKey: 'openai',
    binName: 'codex',
    installCommands: {
      sandbox: 'npm install -g @openai/codex',
      macos: 'brew install codex',
      linux: 'npm install -g @openai/codex',
      windows: 'npm install -g @openai/codex',
    },
    launchCommand: 'codex',
    sortOrder: 20,
  },
  {
    slug: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    description:
      'Google’s open-source agent for Gemini models with a generous free tier via personal Google accounts.',
    license: 'Apache-2.0',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/google-gemini/gemini-cli/blob/main/LICENSE',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    authKind: 'login',
    authNote:
      'Run `gemini` once and follow the Google sign-in flow, or attach a GEMINI_API_KEY.',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    apiKeyProviderKey: 'gemini',
    binName: 'gemini',
    installCommands: {
      sandbox: 'npm install -g @google/gemini-cli',
      macos: 'brew install gemini-cli',
      linux: 'npm install -g @google/gemini-cli',
      windows: 'npm install -g @google/gemini-cli',
    },
    launchCommand: 'gemini',
    sortOrder: 30,
  },
  {
    slug: 'aider',
    name: 'Aider',
    vendor: 'Aider AI',
    description:
      'Pair-programming agent for the terminal. Works with dozens of providers — bring the key of whichever model you use.',
    license: 'Apache-2.0',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/Aider-AI/aider/blob/main/LICENSE.txt',
    docsUrl: 'https://aider.chat/docs/',
    authKind: 'api_key',
    authNote:
      'Aider reads the key of the provider you pick, e.g. export OPENAI_API_KEY or ANTHROPIC_API_KEY before launching. Attach a key from your vault at launch and Karo wires it for you.',
    binName: 'aider',
    installCommands: {
      sandbox: 'python3 -m pip install aider-install && aider-install',
      macos: 'python3 -m pip install aider-install && aider-install',
      linux: 'python3 -m pip install aider-install && aider-install',
      windows: 'python -m pip install aider-install && aider-install',
    },
    launchCommand: 'aider',
    sortOrder: 40,
  },
  {
    slug: 'opencode',
    name: 'OpenCode',
    vendor: 'Anomaly',
    description:
      'Vendor-neutral terminal agent with a polished TUI. Log in with any of 75+ model providers.',
    license: 'MIT',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/anomalyco/opencode/blob/main/LICENSE',
    docsUrl: 'https://opencode.ai/docs/',
    authKind: 'login',
    authNote: 'Run `opencode auth login` after installing to connect a model provider.',
    binName: 'opencode',
    installCommands: {
      sandbox: 'npm install -g opencode-ai',
      macos: 'brew install anomalyco/tap/opencode',
      linux: 'npm install -g opencode-ai',
      windows: 'npm install -g opencode-ai',
    },
    launchCommand: 'opencode',
    sortOrder: 50,
  },
  {
    slug: 'crush',
    name: 'Crush',
    vendor: 'Charm',
    description:
      'Charm’s glamorous terminal agent. Multi-model, session-aware, and right at home in any TUI workflow.',
    license: 'FSL-1.1-MIT',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/charmbracelet/crush/blob/main/LICENSE.md',
    docsUrl: 'https://github.com/charmbracelet/crush',
    authKind: 'login',
    authNote: 'Run `crush` once and pick a model provider in the onboarding screen.',
    binName: 'crush',
    installCommands: {
      sandbox: 'npm install -g @charmland/crush',
      macos: 'brew install charmbracelet/tap/crush',
      linux: 'npm install -g @charmland/crush',
      windows: 'npm install -g @charmland/crush',
    },
    launchCommand: 'crush',
    sortOrder: 60,
  },
  {
    slug: 'qwen-code',
    name: 'Qwen Code',
    vendor: 'Alibaba',
    description:
      'Alibaba’s agent tuned for Qwen3-Coder, with a free tier through Qwen OAuth login.',
    license: 'Apache-2.0',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/QwenLM/qwen-code/blob/main/LICENSE',
    docsUrl: 'https://qwenlm.github.io/qwen-code-docs/',
    authKind: 'login',
    authNote: 'Run `qwen` once and sign in with your Qwen account for the free tier.',
    binName: 'qwen',
    installCommands: {
      sandbox: 'npm install -g @qwen-code/qwen-code',
      macos: 'npm install -g @qwen-code/qwen-code',
      linux: 'npm install -g @qwen-code/qwen-code',
      windows: 'npm install -g @qwen-code/qwen-code',
    },
    launchCommand: 'qwen',
    sortOrder: 70,
  },
  {
    slug: 'goose',
    name: 'Goose',
    vendor: 'Block',
    description:
      'Block’s open-source extensible agent that runs tasks, automations and coding sessions locally.',
    license: 'Apache-2.0',
    licenseKind: 'free',
    licenseUrl: 'https://github.com/block/goose/blob/main/LICENSE',
    docsUrl: 'https://block.github.io/goose/docs/',
    authKind: 'api_key',
    authNote:
      'Goose asks for a provider key on first run. Attach a key from your vault at launch, or configure it inside the CLI.',
    binName: 'goose',
    installCommands: {
      sandbox:
        'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
      macos:
        'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
      linux:
        'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
      windows: 'winget install Block.Goose',
    },
    launchCommand: 'goose',
    sortOrder: 80,
  },
];
