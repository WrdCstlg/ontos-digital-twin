/**
 * Shared helpers + types for the Module Library page scope.
 * Types mirror the tRPC ontologyRouter outputs (kept local — frontend never
 * imports from api/).
 */

export interface LibraryModule {
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
  createdAt: Date | string;
  updatedAt: Date | string;
  classCount: number;
  propertyCount: number;
  instanceCount: number;
}

export interface ShaclConstraint {
  path?: string;
  minCount?: number;
  maxCount?: number;
  datatype?: string;
  pattern?: string;
  sparql?: string;
  severity?: string;
  message?: string;
}

export interface ShaclShape {
  shape: string;
  constraints: ShaclConstraint[];
}

export interface ClassRow {
  id: number;
  moduleId: number;
  iri: string;
  label: string;
  parentIri: string | null;
  definition: string | null;
  isCustom: boolean;
  deprecated: boolean;
  shaclJson: unknown;
  instanceCount: number;
}

export interface PropRow {
  id: number;
  moduleId: number;
  iri: string;
  label: string;
  kind: 'object' | 'datatype';
  domainIri: string | null;
  rangeIri: string | null;
  rangeDatatype: string | null;
  cardinality: string | null;
  definition: string | null;
}

export interface VersionRow {
  id: number;
  moduleId: number;
  version: string;
  changelog: string | null;
  diffJson: unknown;
  publishedAt: Date | string;
}

/* ── export formats ─────────────────────────────────────────── */

export interface ExportFormatMeta {
  id: 'turtle' | 'owl' | 'jsonld' | 'rdfxml';
  label: string;
  tag: string;
  ext: string;
  mime: string;
}

export const EXPORT_FORMATS: ExportFormatMeta[] = [
  { id: 'turtle', label: 'Turtle', tag: 'TTL', ext: 'ttl', mime: 'text/turtle' },
  { id: 'owl', label: 'OWL / RDF', tag: 'OWL', ext: 'owl', mime: 'application/rdf+xml' },
  { id: 'jsonld', label: 'JSON-LD', tag: 'JSON-LD', ext: 'jsonld', mime: 'application/ld+json' },
  { id: 'rdfxml', label: 'RDF/XML', tag: 'RDF/XML', ext: 'rdf', mime: 'application/rdf+xml' },
];

/** Download serialized module content; returns human-readable size. */
export function downloadExport(filename: string, content: string, mime: string): string {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const kb = Math.max(1, Math.round(blob.size / 1024));
  return `${kb} KB`;
}

/* ── misc formatting ────────────────────────────────────────── */

export function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function fmtDate(d: Date | string | null | undefined): string {
  const dt = toDate(d);
  if (!dt) return '—';
  return dt.toISOString().slice(0, 10);
}

export function relTime(d: Date | string | null | undefined): string {
  const dt = toDate(d);
  if (!dt) return '—';
  const s = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** hex (#RRGGBB) + alpha → 8-digit hex */
export function alpha(hex: string, a: number): string {
  const v = Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${v}`;
}

/* ── cross-module dependency metadata (static ontology fact) ── */

export const DEPENDENCIES: Record<string, { dependsOn: string[]; dependedBy: string[] }> = {
  hr: { dependsOn: [], dependedBy: ['legal', 'compliance'] },
  legal: { dependsOn: ['hr'], dependedBy: ['compliance', 'finance'] },
  compliance: { dependsOn: ['legal', 'finance'], dependedBy: [] },
  finance: { dependsOn: ['legal'], dependedBy: ['compliance', 'logistics'] },
  logistics: { dependsOn: ['finance'], dependedBy: [] },
};

/* ── SHACL shape → Turtle ───────────────────────────────────── */

export function shaclToTurtle(shape: ShaclShape, prefix: string): string {
  const lines: string[] = [
    `@prefix sh: <http://www.w3.org/ns/shacl#> .`,
    `@prefix ${prefix}: <https://ontos.acme.corp/ontology/${prefix}/> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    ``,
    `${shape.shape} a sh:NodeShape ;`,
  ];
  shape.constraints.forEach((c, i) => {
    const last = i === shape.constraints.length - 1;
    lines.push(`  sh:property [`);
    if (c.path) lines.push(`    sh:path ${c.path} ;`);
    if (c.minCount != null) lines.push(`    sh:minCount ${c.minCount} ;`);
    if (c.maxCount != null) lines.push(`    sh:maxCount ${c.maxCount} ;`);
    if (c.datatype) lines.push(`    sh:datatype ${c.datatype} ;`);
    if (c.pattern) lines.push(`    sh:pattern "${c.pattern}" ;`);
    if (c.sparql) lines.push(`    sh:sparql """${c.sparql}""" ;`);
    if (c.severity) lines.push(`    sh:severity sh:${c.severity} ;`);
    if (c.message) lines.push(`    sh:message "${c.message}" ;`);
    lines.push(`  ]${last ? ' .' : ' ;'}`);
  });
  return lines.join('\n');
}

export function parseShacl(raw: unknown): ShaclShape | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ShaclShape>;
  if (typeof s.shape !== 'string' || !Array.isArray(s.constraints)) return null;
  return { shape: s.shape, constraints: s.constraints as ShaclConstraint[] };
}

/* ── minimal client-side ontology sniffing for the import flow ─ */

export interface ImportParseResult {
  format: string;
  classes: number;
  objectProps: number;
  datatypeProps: number;
  shapes: number;
}

export function sniffOntology(filename: string, text: string): ImportParseResult {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  if (ext === 'jsonld' || text.trimStart().startsWith('{')) {
    return {
      format: 'JSON-LD',
      classes: count(/"@type"\s*:\s*"owl:Class"/g),
      objectProps: count(/"@type"\s*:\s*"owl:ObjectProperty"/g),
      datatypeProps: count(/"@type"\s*:\s*"owl:DatatypeProperty"/g),
      shapes: count(/sh:NodeShape/g),
    };
  }
  if (ext === 'rdf' || ext === 'owl' || text.trimStart().startsWith('<')) {
    return {
      format: 'RDF/XML',
      classes: count(/<owl:Class[\s>]/g),
      objectProps: count(/<owl:ObjectProperty[\s>]/g),
      datatypeProps: count(/<owl:DatatypeProperty[\s>]/g),
      shapes: count(/sh:NodeShape/g),
    };
  }
  return {
    format: 'Turtle',
    classes: count(/a\s+owl:Class/g),
    objectProps: count(/a\s+owl:ObjectProperty/g),
    datatypeProps: count(/a\s+owl:DatatypeProperty/g),
    shapes: count(/a\s+sh:NodeShape/g),
  };
}
