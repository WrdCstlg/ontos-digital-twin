/**
 * Ontos module color system — the semantic identity of the product.
 * Each business function owns a hue, used consistently for classes, nodes,
 * badges, tabs, chips, KPIs, and graph edges across every page.
 */

export type ModuleKey = 'hr' | 'legal' | 'compliance' | 'finance' | 'logistics' | 'twin' | 'custom';

export interface OntologyModule {
  key: ModuleKey;
  /** Uppercase mono label, e.g. "HR" */
  label: string;
  /** Human name, e.g. "Human Resources" */
  name: string;
  /** IRI namespace prefix, e.g. "hr" */
  prefix: string;
  /** Module hue hex */
  color: string;
  /** Tailwind text color class */
  textClass: string;
  /** Library route / anchor */
  route: string;
  /** Glyph asset in /public */
  glyph: string;
}

export const MODULES: readonly OntologyModule[] = [
  {
    key: 'hr',
    label: 'HR',
    name: 'Human Resources',
    prefix: 'hr',
    color: '#FB7185',
    textClass: 'text-module-hr',
    route: '/app/library#hr',
    glyph: '/module-hr.svg',
  },
  {
    key: 'legal',
    label: 'LEGAL',
    name: 'Legal',
    prefix: 'legal',
    color: '#A78BFA',
    textClass: 'text-module-legal',
    route: '/app/library#legal',
    glyph: '/module-legal.svg',
  },
  {
    key: 'compliance',
    label: 'COMPLIANCE',
    name: 'Compliance',
    prefix: 'cmp',
    color: '#34D399',
    textClass: 'text-module-compliance',
    route: '/app/library#compliance',
    glyph: '/module-compliance.svg',
  },
  {
    key: 'finance',
    label: 'FINANCE',
    name: 'Finance',
    prefix: 'fin',
    color: '#FBBF24',
    textClass: 'text-module-finance',
    route: '/app/library#finance',
    glyph: '/module-finance.svg',
  },
  {
    key: 'logistics',
    label: 'LOGISTICS',
    name: 'Logistics',
    prefix: 'log',
    color: '#38BDF8',
    textClass: 'text-module-logistics',
    route: '/app/library#logistics',
    glyph: '/module-logistics.svg',
  },
  {
    key: 'twin',
    label: 'TWIN',
    name: 'Digital Twin',
    prefix: 'dtwin',
    color: '#2DD4BF',
    textClass: 'text-module-twin',
    route: '/app/twins',
    glyph: '/module-twin.svg',
  },
] as const;

export const CUSTOM_MODULE: OntologyModule = {
  key: 'custom',
  label: 'CUSTOM',
  name: 'Custom Extension',
  prefix: 'ext',
  color: '#94A3B8',
  textClass: 'text-module-custom',
  route: '/app/library#custom',
  glyph: '/empty-graph.svg',
};

const BY_KEY: Record<ModuleKey, OntologyModule> = {
  hr: MODULES[0],
  legal: MODULES[1],
  compliance: MODULES[2],
  finance: MODULES[3],
  logistics: MODULES[4],
  twin: MODULES[5],
  custom: CUSTOM_MODULE,
};

const PREFIX_TO_KEY: Record<string, ModuleKey> = {
  hr: 'hr',
  legal: 'legal',
  cmp: 'compliance',
  fin: 'finance',
  log: 'logistics',
  lgx: 'logistics',
  dtwin: 'twin',
  ext: 'custom',
};

export function getModule(key: ModuleKey): OntologyModule {
  return BY_KEY[key];
}

/** Resolve an IRI prefix ("hr", "fin", "cmp", …) to a module. Unknown → custom. */
export function moduleForPrefix(prefix: string): OntologyModule {
  return BY_KEY[PREFIX_TO_KEY[prefix] ?? 'custom'];
}

/** Apply alpha to a module hex color, e.g. moduleAlpha('#FB7185', 0.15). */
export function moduleAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
