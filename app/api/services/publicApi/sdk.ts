import type { ActionParameter } from "@contracts/actions";
import type { OntologyModel, ScalarType } from "./model";

/**
 * Generates a TypeScript client for a workspace's Ontology API: one file, no
 * dependencies, with an interface per object type and a parameter type per
 * action type. It records the ontology version it was generated from and
 * notices when the server's differs.
 */

function tsScalar(t: ScalarType): string {
  switch (t) {
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

function tsParam(p: ActionParameter): string {
  switch (p.type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return p.options.map((o) => JSON.stringify(o)).join(" | ");
    default:
      return "string";
  }
}

/** A JSDoc block, safe to embed: no comment terminators from ontology text. */
function doc(lines: (string | null | undefined)[], indent = ""): string {
  const text = lines.filter((l): l is string => !!l).map((l) => l.replace(/\*\//g, "*\\/"));
  if (text.length === 0) return "";
  if (text.length === 1) return `${indent}/** ${text[0]} */\n`;
  return `${indent}/**\n${text.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}

const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));

export function generateTypeScriptSdk(model: OntologyModel, generatedAt = new Date()): string {
  const out: string[] = [];
  out.push(
    `// Ontos Ontology API client for "${model.workspace.name}".`,
    `// Generated ${generatedAt.toISOString()} from ontology version ${model.version}. Do not edit:`,
    `// download it again from the Developers page when the ontology changes.`,
    ``,
    `export const ONTOLOGY_VERSION = ${JSON.stringify(model.version)};`,
    ``,
    `export interface ObjectSource {`,
    `  /** The mapping that imported the object, if one did. */`,
    `  mappingId: number | null;`,
    `  /** The action submission that last changed the object, if one did. */`,
    `  submissionId: number | null;`,
    `}`,
    ``,
    `export interface OntologyObject<T extends string = string, P = Record<string, unknown>, L = Record<string, string[]>> {`,
    `  iri: string;`,
    `  /** The object's class: T or one of its subclasses. */`,
    `  objectType: string;`,
    `  label: string;`,
    `  properties: P & Record<string, unknown>;`,
    `  links: L & Record<string, string[]>;`,
    `  source: ObjectSource;`,
    `  createdAt: string;`,
    `  updatedAt: string;`,
    `  /** @internal */ readonly __type?: T;`,
    `}`,
    ``,
  );

  for (const t of model.objectTypes) {
    out.push(doc([`${t.label} (${t.iri}), module ${t.module.name}.`, t.description, t.deprecated ? "@deprecated" : null]));
    out.push(`export interface ${t.apiName}Properties {`);
    for (const p of t.properties) {
      out.push(doc([`${p.label} (${p.iri}).`, p.description], "  ").trimEnd());
      out.push(`  ${key(p.key)}?: ${tsScalar(p.type)}${p.multiple ? "[]" : ""};`);
    }
    out.push(`}`);
    out.push(`export interface ${t.apiName}Links {`);
    for (const l of t.links) {
      out.push(doc([`${l.label} (${l.iri})${l.target ? `: IRIs of ${l.target} objects` : ""}.`, l.description], "  ").trimEnd());
      out.push(`  ${key(l.key)}?: string[];`);
    }
    out.push(`}`);
    out.push(`export type ${t.apiName} = OntologyObject<${JSON.stringify(t.iri)}, ${t.apiName}Properties, ${t.apiName}Links>;`, ``);
  }
  out.push(`export interface ObjectTypes {`);
  for (const t of model.objectTypes) out.push(`  ${JSON.stringify(t.iri)}: ${t.apiName};`);
  out.push(`}`, ``);
  out.push(`const OBJECT_PATHS: Record<keyof ObjectTypes, string> = {`);
  for (const t of model.objectTypes) out.push(`  ${JSON.stringify(t.iri)}: ${JSON.stringify(`/objects/${t.prefix}/${t.localName}`)},`);
  out.push(`};`, ``);

  for (const a of model.actionTypes) {
    out.push(doc([`${a.displayName} (${a.key}, v${a.version}). Needs the ${a.minRole} role or higher.`, a.description]));
    out.push(`export interface ${a.apiName}Params {`);
    for (const p of a.parameters) {
      const note = p.type === "object" ? `The IRI of a ${p.classIri}.` : p.type === "date" ? "A date, YYYY-MM-DD." : null;
      out.push(doc([p.label + ".", note, p.description ?? null], "  ").trimEnd());
      out.push(`  ${key(p.name)}${p.required ? "" : "?"}: ${tsParam(p)}${p.required ? "" : " | null"};`);
    }
    out.push(`}`, ``);
  }
  out.push(`export interface ActionParams {`);
  for (const a of model.actionTypes) out.push(`  ${JSON.stringify(a.key)}: ${a.apiName}Params;`);
  out.push(`}`, ``);

  out.push(CLIENT);
  return out.filter((l) => l !== "").join("\n").replace(/\n(export |const |\/\*\*|\/\/ )/g, "\n\n$1").trim() + "\n";
}

const CLIENT = `export interface Problem { code: string; message: string; path?: string }

export interface Changes {
  created: { iri: string; classIri: string; label: string }[];
  modified: { iri: string; set: Record<string, { from: unknown; to: unknown }>; unset: string[] }[];
  deleted: { iri: string; label: string }[];
  linksAdded: { from: string; predicate: string; to: string }[];
  linksRemoved: { from: string; predicate: string; to: string }[];
}

export interface Criterion { index: number; message: string; passed: boolean; detail?: string }

export interface Preview {
  canApply: boolean;
  problems: Problem[];
  criteria: Criterion[];
  changes: Changes;
  shacl: { status: string; violations: unknown[] };
}

export interface Submission {
  id: number;
  actionKey: string;
  actionVersion: number;
  status: "applied" | "rejected";
  submittedBy: string;
  params: Record<string, unknown>;
  changes: Changes | null;
  problems: Problem[];
  createdAt: string;
}

export interface SubmitResult extends Omit<Preview, "canApply"> { submission: Submission }

export interface Page<T> { data: T[]; nextCursor: string | null }

export class OntosApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problems: Problem[];
  constructor(status: number, code: string, message: string, problems: Problem[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.problems = problems;
  }
}

export interface OntosClientOptions {
  /** The app's origin, e.g. https://ontos.example.com. */
  baseUrl: string;
  /** An API token (ontos_…) from the Developers page. */
  token: string;
  fetch?: typeof fetch;
  /** Called once if the server's ontology version differs from ONTOLOGY_VERSION. */
  onVersionMismatch?: (server: string, client: string) => void;
}

export class OntosClient {
  private readonly opts: OntosClientOptions;
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private warned = false;

  constructor(opts: OntosClientOptions) {
    this.opts = opts;
    this.base = opts.baseUrl.replace(/\\/+$/, "") + "/api/v1";
    this.doFetch = opts.fetch ?? fetch;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.doFetch(this.base + path, {
      method,
      headers: { authorization: \`Bearer \${this.opts.token}\`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const server = res.headers.get("x-ontos-ontology-version");
    if (server && server !== ONTOLOGY_VERSION && !this.warned) {
      this.warned = true;
      (this.opts.onVersionMismatch ?? ((s, c) => console.warn(\`Ontos: the server's ontology is version \${s}; this client was generated from \${c}. Download it again.\`)))(server, ONTOLOGY_VERSION);
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const e = (payload as { error?: { code?: string; message?: string; problems?: Problem[] } } | null)?.error;
      throw new OntosApiError(res.status, e?.code ?? "HTTP_" + res.status, e?.message ?? res.statusText, e?.problems ?? []);
    }
    return payload as T;
  }

  /** Objects of one type, subclasses included. */
  objects<K extends keyof ObjectTypes>(type: K) {
    const path = OBJECT_PATHS[type];
    return {
      list: (opts: { limit?: number; cursor?: string | null; q?: string; filter?: Record<string, string> } = {}): Promise<Page<ObjectTypes[K]>> => {
        const qs = new URLSearchParams();
        if (opts.limit) qs.set("limit", String(opts.limit));
        if (opts.cursor) qs.set("cursor", opts.cursor);
        if (opts.q) qs.set("q", opts.q);
        for (const [k, v] of Object.entries(opts.filter ?? {})) qs.set(\`filter[\${k}]\`, v);
        const s = qs.toString();
        return this.request("GET", path + (s ? "?" + s : ""));
      },
      get: (id: string): Promise<ObjectTypes[K]> => this.request("GET", \`\${path}/\${encodeURIComponent(id)}\`),
    };
  }

  /** Every object of a type, page by page. */
  async *iterate<K extends keyof ObjectTypes>(type: K, opts: { q?: string; filter?: Record<string, string> } = {}): AsyncGenerator<ObjectTypes[K]> {
    let cursor: string | null = null;
    do {
      const page: Page<ObjectTypes[K]> = await this.objects(type).list({ ...opts, limit: 200, cursor });
      yield* page.data;
      cursor = page.nextCursor;
    } while (cursor);
  }

  /** Any object by its IRI. */
  object(iri: string): Promise<OntologyObject> {
    return this.request("GET", "/objects?iri=" + encodeURIComponent(iri));
  }

  readonly actions = {
    preview: <K extends keyof ActionParams>(key: K, params: ActionParams[K]): Promise<Preview> =>
      this.request("POST", \`/actions/\${String(key)}/preview\`, { params }),
    /** Applies the action, or records why not: a rejection is a result, not an error. */
    submit: <K extends keyof ActionParams>(key: K, params: ActionParams[K]): Promise<SubmitResult> =>
      this.request("POST", \`/actions/\${String(key)}/submit\`, { params }),
  };

  submission(id: number): Promise<Submission> {
    return this.request("GET", \`/submissions/\${id}\`);
  }

  /** Whether this client was generated from the ontology the server has now. */
  async checkVersion(): Promise<{ matches: boolean; server: string; client: string }> {
    const o = await this.request<{ version: string }>("GET", "/ontology");
    return { matches: o.version === ONTOLOGY_VERSION, server: o.version, client: ONTOLOGY_VERSION };
  }
}
`;
