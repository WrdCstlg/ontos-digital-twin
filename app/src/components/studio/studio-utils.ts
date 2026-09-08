import type { ModuleKey } from '@/lib/modules';
import { moduleAlpha } from '@/lib/modules';

/* ------------------------------------------------------------------ *
 * Shared types mirroring the ontology router payloads (frontend-local,
 * never imported from api/).
 * ------------------------------------------------------------------ */

export interface StudioModule {
  id: number;
  workspaceId: number;
  key: string;
  name: string;
  prefix: string;
  color: string;
  version: string;
  status: 'active' | 'draft' | 'deprecated';
  description: string | null;
  documentation: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  classCount: number;
  propertyCount: number;
  instanceCount: number;
}

export interface StudioClass {
  id: number;
  moduleId: number;
  iri: string;
  label: string;
  parentId: number | null;
  parentIri: string | null;
  definition: string | null;
  isCustom: boolean;
  deprecated: boolean;
  shaclJson: ShaclShape | null;
  createdAt: string | Date;
  instanceCount: number;
}

export interface StudioProperty {
  id: number;
  moduleId: number;
  iri: string;
  label: string;
  kind: 'object' | 'datatype';
  domainClassId: number | null;
  rangeClassId: number | null;
  rangeDatatype: string | null;
  cardinality: string | null;
  definition: string | null;
  createdAt: string | Date;
  domainIri: string | null;
  rangeIri: string | null;
}

export interface StudioVersion {
  id: number;
  moduleId: number;
  version: string;
  changelog: string | null;
  diffJson: unknown;
  publishedAt: string | Date;
}

export interface ShaclConstraint {
  path: string;
  minCount?: number;
  maxCount?: number;
  datatype?: string;
  pattern?: string;
  sparql?: string;
  severity?: 'Violation' | 'Warning' | 'Info';
  message?: string;
}

export interface ShaclShape {
  shape: string;
  constraints: ShaclConstraint[];
}

export interface ReasonerResult {
  moduleKey: string;
  version: string;
  reasoner: string;
  durationMs: number;
  classesClassified: number;
  inferredSubClassOf: { child: string; ancestor: string; via: string }[];
  consistent: boolean;
  issues: string[];
  warnings: string[];
  log: string[];
}

export interface DiffResult {
  moduleKey: string;
  fromVersion: string;
  toVersion: string;
  versionsInRange: string[];
  added: { classes: DiffEntry[]; properties: DiffEntry[] };
  removed: { classes: DiffEntry[]; properties: DiffEntry[] };
  changed: DiffEntry[];
  summary: {
    classesAdded: number;
    propertiesAdded: number;
    classesRemoved: number;
    propertiesRemoved: number;
    changed: number;
  };
}

/** Diff entries arrive either as plain IRIs (seeded history) or objects (fresh edits). */
export type DiffEntry = string | { iri: string; label?: string; parentIri?: string | null; note?: string };

export function diffEntryIri(e: DiffEntry): string {
  return typeof e === 'string' ? e : e.iri;
}

/* ------------------------------------------------------------------ *
 * Prefix → module resolution. The backend uses "lgl" for Legal while
 * the shared modules.ts map only knows "legal" — bridge that here.
 * ------------------------------------------------------------------ */

const PREFIX_TO_MODULE_KEY: Record<string, ModuleKey> = {
  hr: 'hr',
  lgl: 'legal',
  legal: 'legal',
  cmp: 'compliance',
  fin: 'finance',
  log: 'logistics',
  ext: 'custom',
};

export function moduleKeyForPrefix(prefix: string): ModuleKey {
  return PREFIX_TO_MODULE_KEY[prefix] ?? 'custom';
}

export function prefixOf(iri: string): string {
  return iri.split(':')[0] ?? '';
}

export function localName(iri: string): string {
  const i = iri.indexOf(':');
  return i >= 0 ? iri.slice(i + 1) : iri;
}

export { moduleAlpha };

/* ------------------------------------------------------------------ *
 * Class tree
 * ------------------------------------------------------------------ */

export interface ClassTreeNode {
  cls: StudioClass;
  children: ClassTreeNode[];
}

export function buildClassTree(classes: StudioClass[]): ClassTreeNode[] {
  const nodes = new Map<string, ClassTreeNode>();
  for (const c of classes) nodes.set(c.iri, { cls: c, children: [] });
  const roots: ClassTreeNode[] = [];
  for (const c of classes) {
    const node = nodes.get(c.iri)!;
    const parent = c.parentIri ? nodes.get(c.parentIri) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: ClassTreeNode[]) => {
    list.sort((a, b) => a.cls.label.localeCompare(b.cls.label));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/* ------------------------------------------------------------------ *
 * SHACL helpers
 * ------------------------------------------------------------------ */

export function constraintType(c: ShaclConstraint): string {
  if (c.sparql) return 'custom SPARQL';
  if (c.pattern) return 'pattern';
  if (c.datatype) return 'datatype';
  if (c.minCount != null || c.maxCount != null) return 'minCount';
  return 'property';
}

export function constraintValue(c: ShaclConstraint): string {
  if (c.sparql) return c.sparql;
  if (c.pattern) return c.pattern;
  if (c.datatype) return c.datatype;
  const parts: string[] = [];
  if (c.minCount != null) parts.push(`min ${c.minCount}`);
  if (c.maxCount != null) parts.push(`max ${c.maxCount}`);
  return parts.join(' · ') || '—';
}

/** Render a class's SHACL shape as read-only Turtle. */
export function shaclToTurtle(cls: StudioClass): string {
  const shape = cls.shaclJson;
  if (!shape) return `# No SHACL shape declared for ${cls.iri}`;
  const lines: string[] = [
    `@prefix sh: <http://www.w3.org/ns/shacl#> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    `@prefix ${prefixOf(cls.iri)}: <https://ontos.dev/ontology/${prefixOf(cls.iri)}/> .`,
    ``,
    `${shape.shape} a sh:NodeShape ;`,
    `  sh:targetClass ${cls.iri} ;`,
  ];
  shape.constraints.forEach((c, i) => {
    const last = i === shape.constraints.length - 1;
    lines.push(`  sh:property [`);
    lines.push(`    sh:path ${c.path} ;`);
    if (c.minCount != null) lines.push(`    sh:minCount ${c.minCount} ;`);
    if (c.maxCount != null) lines.push(`    sh:maxCount ${c.maxCount} ;`);
    if (c.datatype) lines.push(`    sh:datatype ${c.datatype} ;`);
    if (c.pattern) lines.push(`    sh:pattern "${c.pattern}" ;`);
    if (c.sparql) lines.push(`    sh:sparql [ sh:select """${c.sparql}""" ] ;`);
    lines.push(`    sh:severity sh:${c.severity ?? 'Violation'} ;`);
    if (c.message) lines.push(`    sh:message "${c.message}" ;`);
    lines.push(`  ]${last ? ' .' : ' ;'}`);
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export const CARDINALITIES = ['0..1', '1..1', '0..*', '1..*'] as const;

export function cardinalityRequired(card: string | null): boolean {
  return card != null && !card.startsWith('0');
}

export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const EXPORT_FORMATS = [
  { format: 'turtle', label: 'Turtle', ext: '.ttl' },
  { format: 'owl', label: 'OWL / XML', ext: '.owl' },
  { format: 'jsonld', label: 'JSON-LD', ext: '.jsonld' },
  { format: 'rdfxml', label: 'RDF / XML', ext: '.rdf' },
] as const;
