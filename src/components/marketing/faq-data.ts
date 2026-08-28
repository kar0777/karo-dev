import type { FaqEntry } from './json-ld';

/**
 * FAQ copy.
 *
 * Answers are plain text so the same strings can be rendered as prose and
 * serialised into `FAQPage` structured data without divergence. Anything that
 * would need a table or a code block belongs in `/docs`, not here.
 */

export const LANDING_FAQ: readonly FaqEntry[] = [
  {
    question: 'What exactly does "a real computer" mean?',
    answer:
      'Each project gets its own sandboxed Linux machine with a filesystem, a package manager and a shell. The agent runs commands there — installs dependencies, starts a dev server, runs your test suite — and you can open the same terminal and type alongside it. Nothing runs on the Karo web host; every command goes through a sandbox provider.',
  },
  {
    question: 'Can the agent break something outside my project?',
    answer:
      'No. The sandbox has its own PID, mount, network and user namespaces, runs rootless, and never has the host Docker socket mounted. Filesystem access is confined to /workspace and every path the agent supplies is normalised before use, so ../ cannot escape. Commands are classified before they run: destructive ones are blocked outright and borderline ones need your confirmation.',
  },
  {
    question: 'Do I have to let it change my files automatically?',
    answer:
      'Only if you want to. In Build mode the agent proposes diffs and nothing is written until you approve them file by file. Ask mode reads your code to answer the question and changes nothing, Plan mode may also run commands to explore but still writes nothing, and Auto mode acts end to end within the permissions you granted that specific project.',
  },
  {
    question: 'What is a weighted token, and why not just count tokens?',
    answer:
      'Providers charge different rates for input, output, cached-read and cache-write tokens, and those ratios change whenever prices move. One input token is defined as one weighted token, and every other class converts at that model’s current price ratio. A plan allowance therefore keeps its value when a model gets cheaper or you switch models mid-project.',
  },
  {
    question: 'How is compute measured?',
    answer:
      'One base compute hour is one hour of 0.25 vCPU and 512 MB of RAM. A larger machine burns the same budget faster: the multiplier is CPU factor times RAM factor times the provider factor, and it is shown before a sandbox starts. Sandboxes sleep automatically when idle, and sleeping machines do not consume compute.',
  },
  {
    question: 'Can I use my own API key?',
    answer:
      'Yes. Add your provider key and those model tokens are billed by your provider rather than by Karo — they do not draw down your included allowance and they appear in usage marked as BYOK. Keys are encrypted at rest, never returned to the browser, and redacted from logs and tool output.',
  },
  {
    question: 'Can I run the sandboxes on my own hardware?',
    answer:
      'Yes. Install the Karo worker on your own server with a one-time install token. The worker dials out over TLS and long-polls for work, so you never open an inbound port or expose a Docker socket. Compute on your own hardware is still metered so you can see it, but it is never charged.',
  },
  {
    question: 'What are MCP servers, skills and plugins?',
    answer:
      'MCP servers are external tool providers spoken to over the Model Context Protocol — filesystem, git, databases, or anything you write yourself. Skills are system-prompt fragments plus slash commands that teach the agent a specific job. Plugins install runtimes and toolchains into the sandbox, such as Node.js, Python, Docker or the GitHub client.',
  },
  {
    question: 'Does Karo work without any external credentials?',
    answer:
      'Yes. With no provider keys configured, Karo runs in demo mode: a scripted model streams realistic replies and tool calls, a mock sandbox simulates a filesystem and shell, and mock billing simulates checkout. Everything is labelled as demo content and nothing leaves the server.',
  },
  {
    question: 'Who can see my code?',
    answer:
      'Your team, according to the role you assign each member — owner, admin, developer or viewer. Project files live in the sandbox volume attached to that project. Secrets are encrypted with an application key and redacted before any tool output is fed back to the model, which is also the first line of defence against prompt injection from files and web pages.',
  },
  {
    question: 'What happens when I run out of allowance?',
    answer:
      'You are told before the run starts, not after. Karo estimates a task before executing it and checks the estimate against your remaining allowance, balance and spending cap. If it would not fit, the run is blocked with a message that says exactly which limit was hit and what to do about it.',
  },
  {
    question: 'Can I export or delete everything?',
    answer:
      'Yes. Usage can be exported as CSV, audit history is exportable on plans that retain it, and deleting a project destroys its sandbox and volume. Deleting a team removes its projects, sandboxes, keys and encrypted secrets.',
  },
];

export const PRICING_FAQ: readonly FaqEntry[] = [
  {
    question: 'What is included in a subscription?',
    answer:
      'A monthly allowance of weighted tokens and compute hours, plus the plan’s machine sizes, sandbox count, storage and capability flags. Anything past the allowance is billed as overage at the plan’s published rate, which gets cheaper on larger plans.',
  },
  {
    question: 'How does yearly billing work?',
    answer:
      'Yearly plans are priced at ten times the monthly price, so two months are free. The allowance is still monthly — a yearly plan does not let you spend a year of tokens in January.',
  },
  {
    question: 'What does pay as you go actually cost?',
    answer:
      'There is no subscription. You top up a balance and it is drawn down at what Karo pays its providers plus a flat platform margin, for both model tokens and compute seconds. Every charge is itemised with the exact multiplier that was applied.',
  },
  {
    question: 'What happens if I go over my allowance?',
    answer:
      'Overage is billed at the plan’s published rate per million weighted tokens and per compute hour. If the plan does not publish a rate, overage falls back to upstream cost plus the platform margin. You can also set a hard monthly spending cap, and runs that would exceed it are blocked rather than billed.',
  },
  {
    question: 'Is there a fair-use policy?',
    answer:
      'Yes, and it is short: sandboxes are for building and testing your own software. Crypto mining, bulk scraping, credential stuffing, spam, torrenting and reselling raw compute are not allowed. Concurrency and queue priority are plan limits rather than fair-use judgement calls, so the enforcement you meet day to day is a number, not an opinion.',
  },
  {
    question: 'Do unused tokens roll over?',
    answer:
      'No. The allowance resets each billing period. If your usage is spiky, pay as you go or a smaller plan plus overage usually costs less than a plan sized for your worst month.',
  },
  {
    question: 'Can I change plan mid-month?',
    answer:
      'Yes. Upgrades take effect immediately and are prorated; downgrades take effect at the end of the current period so you keep what you already paid for. Cancelling leaves your projects readable — you just cannot start new runs.',
  },
  {
    question: 'Does bringing my own key make it cheaper?',
    answer:
      'Usually, yes, if you already have provider credits. BYOK tokens are billed by your provider and never touch your Karo allowance, so a subscription then pays only for compute, storage and the platform. Pay as you go plus BYOK is the cheapest way to use Karo occasionally.',
  },
  {
    question: 'What counts as a compute hour on a bigger machine?',
    answer:
      'One base compute hour is 0.25 vCPU and 512 MB of RAM. A 0.5 vCPU / 1 GB machine multiplies CPU by 2 and RAM by 2, so it consumes 4 compute hours per wall-clock hour. The exact multiplier is shown before the sandbox starts and again on every usage row.',
  },
  {
    question: 'Are there refunds?',
    answer:
      'Subscriptions are billed for the period in advance. Cancelling at any time stops the next renewal, but the period you are in is not refunded. Consumed usage is never refundable — the tokens and the machine time were really spent. Unused pay-as-you-go balance may be refunded at Karo’s discretion, less anything already consumed. Self-serve plans carry no service-credit scheme for downtime, but a charge the meter did not record is a billing error: tell support and it is corrected.',
  },
];
