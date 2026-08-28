/**
 * Seed data barrel.
 *
 * These modules are pure data — no database client, no `server-only` import —
 * so they can be consumed by the seed script, by the catalogue sync job, and by
 * tests without pulling in a connection.
 */
export {
  ADMIN_SETTING_SEEDS,
  MCP_TEMPLATES_SETTING_KEY,
  PROJECT_TEMPLATES_SETTING_KEY,
  type AdminSettingSeed,
} from './admin-settings';

export {
  MCP_TEMPLATE_SEEDS,
  type McpTemplateEnvField,
  type McpTemplateSeed,
} from './mcp-templates';

export {
  DEFAULT_MODEL_SLUG,
  DEMO_MODEL_SLUG,
  MODEL_PRICE_SEEDS,
  MODEL_SEEDS,
  OMNIAKEY_CATALOG_URL,
  OMNIAKEY_DEFAULT_BASE_URL,
  PROVIDER_SEEDS,
  type ModelPriceSeed,
  type ModelSeed,
  type ProviderSeed,
} from './models';

export { PLAN_SEEDS, type PlanSeed } from './plans';

export { PLUGIN_SEEDS, type PluginSeed } from './plugins';

export { SKILL_SEEDS, type SkillSeed } from './skills';

export {
  PROJECT_TEMPLATE_SEEDS,
  findProjectTemplate,
  type ProjectTemplateSeed,
  type TemplateFile,
} from './templates';
