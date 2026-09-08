/**
 * Shared helpers for the Mapping & Sync page.
 */

export interface ConnectorLike {
  id: number;
  name: string;
  type: 'csv' | 'sql' | 'rest';
  status: 'connected' | 'draft' | 'error';
  configJson?: Record<string, unknown> | null;
  createdAt?: string | Date;
}

export interface ColumnMapShape {
  subject: string;
  label?: string;
  fields?: Record<string, string>;
  links?: { column: string; predicate: string; target: string }[];
}

export interface MappingLike {
  id: number;
  connectorId: number;
  name: string;
  sourceTable: string;
  classIri: string;
  status: 'draft' | 'active' | 'paused';
  columnMapJson?: ColumnMapShape | null;
  module?: { key: string; prefix?: string; name?: string } | null;
  connector?: ConnectorLike | null;
}

export interface SyncJobLike {
  id: number;
  mappingId: number;
  status: 'running' | 'succeeded' | 'failed';
  rowsProcessed: number;
  snapshotLabel: string | null;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  mapping?: MappingLike | null;
  connector?: ConnectorLike | null;
}

/** "2m ago" / "3d ago" style relative time. */
export function relTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const t = typeof d === 'string' ? new Date(d) : d;
  const s = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "14:01:03" mono timestamp. */
export function clockTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const t = typeof d === 'string' ? new Date(d) : d;
  return t.toLocaleTimeString('en-GB', { hour12: false });
}

/** "3.8s" duration between two timestamps. */
export function duration(start: string | Date, end: string | Date | null | undefined): string {
  if (!end) return '…';
  const a = (typeof start === 'string' ? new Date(start) : start).getTime();
  const b = (typeof end === 'string' ? new Date(end) : end).getTime();
  const ms = Math.max(0, b - a);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export type TriggerKind = 'schedule' | 'webhook' | 'cdc' | 'manual';

/** Infer the sync trigger for a connector from its real config. */
export function inferTrigger(conn?: ConnectorLike | null): TriggerKind {
  if (!conn) return 'manual';
  const cfg = (conn.configJson ?? {}) as Record<string, unknown>;
  if (conn.type === 'sql' && cfg.mode === 'cdc') return 'cdc';
  if (typeof cfg.schedule === 'string' && cfg.schedule) return 'schedule';
  if (conn.type === 'rest') return 'webhook';
  return 'manual';
}

/** Detect a column value type from sample values. */
export function detectColumnType(values: string[]): 'int' | 'date' | 'string' {
  const sample = values.filter((v) => v !== '').slice(0, 12);
  if (sample.length === 0) return 'string';
  if (sample.every((v) => /^-?\d+$/.test(v))) return 'int';
  if (sample.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return 'date';
  return 'string';
}

/** Default transformation badge for a column/property pair. */
export function defaultTransform(column: string, sampleValues?: string[]): string {
  const type = detectColumnType(sampleValues ?? []);
  if (type === 'date' || /_date$|^date_/.test(column)) return 'parse-date ISO8601';
  if (type === 'int') return 'parse-int';
  return 'identity';
}

/** Apply a transformation to a raw value (client-side live test). */
export function applyTransform(transform: string, value: string): string {
  switch (transform) {
    case 'identity':
      return value;
    case 'uppercase':
      return value.toUpperCase();
    case 'concat':
      return `${value}-unit`;
    case 'parse-int': {
      const n = parseInt(value, 10);
      return Number.isNaN(n) ? '∅ (not an int)' : String(n);
    }
    case 'parse-date ISO8601': {
      const t = Date.parse(value);
      return Number.isNaN(t) ? '∅ (unparseable date)' : new Date(t).toISOString().slice(0, 10);
    }
    case 'trim':
      return value.trim();
    default:
      return value;
  }
}

export const TRANSFORMS = ['identity', 'uppercase', 'concat', 'parse-int', 'parse-date ISO8601', 'trim'];

/** Render an IRI template with row values. */
export function renderTemplate(tpl: string, row: Record<string, string>): string {
  return tpl.replace(/\{([^}]+)\}/g, (_, k: string) => row[k] ?? `{${k}}`);
}

/** Generate a read-only R2RML-flavored Turtle view of a mapping. */
export function generateR2RML(opts: {
  name: string;
  sourceTable: string;
  classIri: string;
  columnMap: ColumnMapShape;
}): string {
  const { name, sourceTable, classIri, columnMap } = opts;
  const lines: string[] = [
    `@prefix rr: <http://www.w3.org/ns/r2rml#> .`,
    `@prefix ontos: <https://ontos.acme.corp/ontology/> .`,
    ``,
    `# ${name}`,
    `<#${sourceTable.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-triples> a rr:TriplesMap ;`,
    `  rr:logicalTable [ rr:tableName "${sourceTable}" ] ;`,
    `  rr:subjectMap [`,
    `    rr:template "${columnMap.subject}" ;`,
    `    rr:class ${classIri} ;`,
    `  ] ;`,
  ];
  const fields = Object.entries(columnMap.fields ?? {});
  fields.forEach(([col, pred], i) => {
    lines.push(
      `  rr:predicateObjectMap [`,
      `    rr:predicate ${pred} ;`,
      `    rr:objectMap [ rr:column "${col}" ; rr:datatype xsd:string ] ;`,
      `  ]${i === fields.length - 1 && (columnMap.links ?? []).length === 0 ? ' .' : ' ;'}`,
    );
  });
  (columnMap.links ?? []).forEach((l, i) => {
    lines.push(
      `  rr:predicateObjectMap [`,
      `    rr:predicate ${l.predicate} ;`,
      `    rr:objectMap [ rr:template "${l.target.replace('{value}', `{${l.column}}`)}" ] ;`,
      `  ]${i === (columnMap.links ?? []).length - 1 ? ' .' : ' ;'}`,
    );
  });
  return lines.join('\n');
}

/** Tiny CSV parser for client-side header/column detection (matches backend semantics). */
export function parseCsvHead(csvText: string, maxRows = 8): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvText.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length && rows.length < maxRows; i++) {
    const cells = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => (row[h] = (cells[j] ?? '').trim()));
    rows.push(row);
  }
  return { headers, rows };
}
