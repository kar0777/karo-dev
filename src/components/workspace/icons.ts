import {
  Braces,
  Boxes,
  Database,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FileText,
  FileType,
  Globe,
  Hammer,
  Layers,
  Palette,
  Package,
  Search,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon and language lookups for the workspace.
 *
 * `@/lib/agent/tools` has an equivalent `languageFor`, but that module is
 * `server-only` (it talks to the database), so the browser needs its own copy.
 * Keep the two tables in step when adding an extension.
 */

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  env: 'ini',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'graphql',
  lock: 'yaml',
  txt: 'plaintext',
};

/** Monaco language id for a workspace path, or `plaintext`. */
export function languageForPath(path: string): string {
  const name = path.split('/').pop() ?? '';
  if (/^dockerfile/i.test(name)) return 'dockerfile';
  if (/^makefile$/i.test(name)) return 'makefile';
  if (/^\.env/i.test(name)) return 'ini';
  if (/^\.gitignore$|^\.dockerignore$/i.test(name)) return 'plaintext';
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  return LANGUAGE_BY_EXTENSION[ext] ?? 'plaintext';
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp']);

/** Lucide icon for a file, chosen by name first and extension second. */
export function fileIconFor(path: string): LucideIcon {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  if (name === 'package.json' || name === 'package-lock.json') return Package;
  if (name.startsWith('dockerfile') || name === 'docker-compose.yml') return Boxes;
  if (name.startsWith('.env')) return FileLock;
  if (name === 'readme.md' || name === 'license') return FileText;
  if (/\.(config|rc)\.(ts|js|mjs|cjs|json)$/.test(name) || name.startsWith('.eslintrc')) {
    return FileCog;
  }

  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (IMAGE_EXTENSIONS.has(ext)) return FileImage;
  if (ext === 'json' || ext === 'jsonc') return FileBraces;
  if (ext === 'css' || ext === 'scss' || ext === 'less') return Palette;
  if (ext === 'sql' || ext === 'db' || ext === 'prisma') return Database;
  if (ext === 'md' || ext === 'mdx' || ext === 'txt') return FileText;
  if (ext === 'html' || ext === 'htm') return Globe;
  if (ext === 'sh' || ext === 'bash' || ext === 'ps1' || ext === 'bat') return Terminal;
  if (ext === 'yml' || ext === 'yaml' || ext === 'toml' || ext === 'ini') return FileType;
  if (LANGUAGE_BY_EXTENSION[ext]) return FileCode;
  return FileText;
}

/** True when the editor should refuse to open the file as text. */
export function isBinaryPath(path: string): boolean {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return (
    IMAGE_EXTENSIONS.has(ext) ||
    ['pdf', 'zip', 'gz', 'tar', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'mp3', 'wasm'].includes(
      ext,
    )
  );
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  run_command: Terminal,
  read_file: FileText,
  write_file: FileCode,
  edit_file: FileCode,
  delete_file: Trash2,
  list_files: Layers,
  search_files: Search,
  web_fetch: Globe,
};

export function toolIconFor(toolName: string, source: string): LucideIcon {
  const direct = TOOL_ICONS[toolName];
  if (direct) return direct;
  if (source === 'mcp') return Braces;
  if (source === 'plugin') return Package;
  if (source === 'skill') return Hammer;
  return Wrench;
}
