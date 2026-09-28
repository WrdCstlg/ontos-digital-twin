import {
  buildPrefixMap,
  datatypeRanges,
  formatIri,
  knowledgeGraphSubjects,
  modulePrefixes,
  moduleSubjects,
  serializePrefixes,
  subjectToTurtle,
  type TurtleSubject,
} from "./rdfBridge";
import type { GraphChanges, GraphHead, GraphSchema } from "./graphSnapshot";

/**
 * A persistent copy of a workspace's graph, in a semantic engine of its own,
 * brought up to date from change capture rather than cleared and reloaded.
 *
 * The copy holds, beside the graph in its default graph, bookkeeping in the
 * named graph <urn:ontos:meta>: the MySQL graph version it holds (every
 * subject at least as new as at that version), the epoch it was built from,
 * and the writer applying its next version. Catching up from version V to T
 * replaces each subject changed after V, in requests the engine applies whole
 * or not at all. Each request first checks, in the engine, that the copy is
 * still at V and its writer still this one (the fence): a writer that lost
 * its turn, or a request replayed, changes nothing. A lock keeps writers from
 * duplicating work; the fence keeps a writer that lost the lock, and whose
 * requests the engine still runs, from doing harm.
 */

const META = "<urn:ontos:meta>";
const GRAPH = "<urn:ontos:graph>";
const VERSION = "<urn:ontos:version>";
const EPOCH = "<urn:ontos:epoch>";
const WRITER = "<urn:ontos:writer>";
const FENCE = "<urn:ontos:fence>";

/** What a copy says it holds. */
export type CopyMeta = { version: number; epoch: string | null; writer: string | null };

/** The query that reads a copy's bookkeeping. */
export const META_QUERY = `SELECT ?version ?epoch ?writer WHERE { GRAPH ${META} { ${GRAPH} ${VERSION} ?version . OPTIONAL { ${GRAPH} ${EPOCH} ?epoch } OPTIONAL { ${GRAPH} ${WRITER} ?writer } } }`;

/** The text of an RDF term as the engine answers it: `"7"^^<…#integer>`, `"abc"`, or a bare value. */
export function termValue(term: string | undefined): string | null {
  if (term === undefined || term === null) return null;
  const literal = /^"((?:[^"\\]|\\.)*)"(?:\^\^<[^>]*>|@[A-Za-z-]+)?$/s.exec(term);
  if (!literal) return term;
  return literal[1].replace(/\\(["\\nrt])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t" })[c] ?? c);
}

/**
 * A copy's bookkeeping from META_QUERY's rows, or null when it has none: an
 * empty store, or one mid-rebuild. More than one version is a copy no fence
 * could have made: it is refused, and rebuilt.
 */
export function readCopyMeta(rows: Record<string, string>[]): CopyMeta | null {
  if (rows.length === 0) return null;
  const versions = new Set(rows.map((r) => termValue(r.version)));
  if (versions.size !== 1) throw new Error(`the copy holds ${versions.size} versions`);
  const writers = new Set(rows.map((r) => termValue(r.writer)));
  if (writers.size !== 1) throw new Error(`the copy has ${writers.size} writers`);
  const version = Number([...versions][0]);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error(`the copy's version reads '${[...versions][0]}'`);
  return { version, epoch: termValue(rows[0].epoch), writer: termValue(rows[0].writer) };
}

/** Why a copy must be rebuilt rather than caught up, or null if it can catch up. */
export function rebuildReason(copy: CopyMeta | null, head: GraphHead, everything = false): string | null {
  if (!copy) return "it holds no version";
  if (copy.epoch !== head.epoch) return "it was built from another epoch";
  if (copy.version > head.version) return `it holds version ${copy.version}, ahead of MySQL's ${head.version}`;
  if (copy.version < head.minRetainedVersion) return `it holds version ${copy.version}, older than the changes kept (${head.minRetainedVersion})`;
  if (everything) return "a change since reaches every subject";
  return null;
}

/** A subject whose statements are replaced: `statements` null when it leaves the graph. */
export type SubjectChange = { subject: string; statements: string[] | null };

/**
 * Each subject `changes` names, rendered as the whole graph renders it
 * (rdfBridge.ts). A node renders its type, label, properties and its links to
 * live nodes; a deleted node, only its removal.
 */
export function renderChanges(changes: GraphChanges): { prefixMap: Map<string, string>; subjects: SubjectChange[] } {
  const { schema } = changes;
  const prefixMap = buildPrefixMap(schema.modules);
  const out: SubjectChange[] = [];

  const live = changes.nodes.filter((n) => n.deletedAt === null);
  const rendered = new Map(
    knowledgeGraphSubjects([...live, ...changes.targets], changes.edges, prefixMap, datatypeRanges(schema.properties), modulePrefixes(schema.modules))
      .slice(0, live.length)
      .map((s, i) => [live[i].id, s] as const),
  );
  for (const n of changes.nodes) {
    // A deleted node's statements were stored under its IRI as a subject renders it.
    out.push(rendered.get(n.id) ?? { subject: formatIri(n.iri, prefixMap), statements: null });
  }

  const classIds = new Set(changes.classIds);
  const propertyIds = new Set(changes.propertyIds);
  if (classIds.size || propertyIds.size) {
    for (const m of schema.modules) {
      const classes = schema.classes.filter((c) => c.moduleId === m.id);
      const properties = schema.properties.filter((p) => p.moduleId === m.id);
      const subjects = moduleSubjects(classes, properties, prefixMap);
      classes.forEach((c, i) => classIds.has(c.id) && out.push(subjects[i]));
      properties.forEach((p, i) => propertyIds.has(p.id) && out.push(subjects[classes.length + i]));
    }
  }
  return { prefixMap, subjects: out };
}

/** The whole graph's schema subjects, module by module, as a rebuild loads them. */
export function schemaSubjects(schema: GraphSchema, prefixMap: Map<string, string>): TurtleSubject[] {
  return schema.modules.flatMap((m) =>
    moduleSubjects(
      schema.classes.filter((c) => c.moduleId === m.id),
      schema.properties.filter((p) => p.moduleId === m.id),
      prefixMap,
    ),
  );
}

/** Bytes `text` takes inside a JSON string, as the request carries it. */
function jsonBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
}

/** A string literal for SPARQL. */
const literal = (s: string) => JSON.stringify(s);

/** Sets the copy's writer: the first request of a catch-up takes the copy over. */
function takeover(writer: string): string[] {
  return [`DELETE WHERE { GRAPH ${META} { ${GRAPH} ${WRITER} ?w } }`, `INSERT DATA { GRAPH ${META} { ${GRAPH} ${WRITER} ${literal(writer)} } }`];
}

/**
 * Stops the request unless the copy is at `version` with writer `writer`. The
 * INSERT writes to the fence graph only when both hold, and DROP GRAPH fails on
 * a graph that is not there, which rolls the whole request back.
 */
function fence(version: number, writer: string): string[] {
  return [
    `INSERT { GRAPH ${FENCE} { ${FENCE} ${VERSION} ${version} } } WHERE { GRAPH ${META} { ${GRAPH} ${VERSION} ?v . ${GRAPH} ${WRITER} ?w } FILTER(?v = ${version} && ?w = ${literal(writer)}) }`,
    `DROP GRAPH ${FENCE}`,
  ];
}

/** Sets the copy's version. */
function setVersion(version: number): string[] {
  return [`DELETE WHERE { GRAPH ${META} { ${GRAPH} ${VERSION} ?old } }`, `INSERT DATA { GRAPH ${META} { ${GRAPH} ${VERSION} ${version} } }`];
}

/** The bookkeeping a rebuilt copy starts with: its version and epoch, and no writer. */
export function rebuiltMeta(version: number, epoch: string): string {
  return [
    `DELETE WHERE { GRAPH ${META} { ${GRAPH} ?p ?o } }`,
    `INSERT DATA { GRAPH ${META} { ${GRAPH} ${VERSION} ${version} ; ${EPOCH} ${literal(epoch)} } }`,
  ].join(" ;\n");
}

/**
 * The requests that bring a copy from version `from` to `to`, replacing
 * `subjects`, as writer `writer`. Each is at most `maxBytes` as the request
 * carries it, and applies whole or not at all:
 * - the first takes the copy over (sets its writer), then fences;
 * - every one fences on (`from`, `writer`), so a writer that lost its turn,
 *   or a request replayed after the version moved, changes nothing;
 * - the last sets the version to `to`.
 * A subject is removed and written again in one request; one too large for
 * a request has its statements split over several, the first beside its
 * removal. Until the last request, the copy stays at `from` with every
 * subject at least as new: a catch-up cut short is one the next redoes.
 */
export function planUpdates(opts: {
  prefixMap: Map<string, string>;
  subjects: SubjectChange[];
  from: number;
  to: number;
  writer: string;
  maxBytes: number;
}): string[] {
  const { prefixMap, subjects, from, to, writer, maxBytes } = opts;
  const prefixes = [...prefixMap.entries()].map(([p, uri]) => `PREFIX ${p}: <${uri}>`).join("\n") + "\n";
  const join = " ;\n";
  // What every request may hold beside its fixed operations, sized for the
  // first, which holds the most of them: the takeover, the fence and the version.
  const fixed = [...takeover(writer), ...fence(from, writer), ...setVersion(to)];
  const capacity = maxBytes - jsonBytes(prefixes) - fixed.reduce((n, op) => n + jsonBytes(op) + jsonBytes(join), 0);
  if (capacity <= 0) throw new Error(`a request of ${maxBytes} bytes cannot hold even the fence`);

  // The subjects' operations, in groups that must share a request.
  const groups: string[][] = [];
  for (const s of subjects) {
    const remove = `DELETE WHERE { ${s.subject} ?p ?o }`;
    if (!s.statements || s.statements.length === 0) {
      groups.push([remove]);
      continue;
    }
    const insert = (statements: string[]) => `INSERT DATA { ${subjectToTurtle({ subject: s.subject, statements }).trimEnd()} }`;
    const whole = insert(s.statements);
    if (jsonBytes(remove) + jsonBytes(whole) + 2 * jsonBytes(join) <= capacity) {
      groups.push([remove, whole]);
      continue;
    }
    // Too large: the statements in parts, the first with the removal. A
    // part's size is the sum of its pieces', escaping being per character.
    const shell = jsonBytes(`INSERT DATA { ${s.subject} `) + jsonBytes(" . }") + jsonBytes(join);
    const separator = jsonBytes(" ;\n  ");
    const removal = jsonBytes(remove) + jsonBytes(join);
    let part: string[] = [];
    let partBytes = 0;
    let first = true;
    const flushPart = () => {
      groups.push(first ? [remove, insert(part)] : [insert(part)]);
      first = false;
      part = [];
      partBytes = 0;
    };
    for (const statement of s.statements) {
      const bytes = jsonBytes(statement);
      if (removal + shell + bytes > capacity) {
        throw new Error(`${s.subject} has a statement of ${bytes} bytes, more than one request to the engine can carry`);
      }
      if (part.length && (first ? removal : 0) + shell + partBytes + separator + bytes > capacity) flushPart();
      partBytes += (part.length ? separator : 0) + bytes;
      part.push(statement);
    }
    if (part.length) flushPart();
  }

  const requests: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const g of groups) {
    const bytes = g.reduce((n, op) => n + jsonBytes(op) + jsonBytes(join), 0);
    if (current.length && used + bytes > capacity) {
      requests.push(current);
      current = [];
      used = 0;
    }
    current.push(...g);
    used += bytes;
  }
  requests.push(current);

  return requests.map((ops, i) => {
    const first = i === 0;
    const last = i === requests.length - 1;
    return prefixes + [...(first ? takeover(writer) : []), ...fence(from, writer), ...ops, ...(last ? setVersion(to) : [])].join(join);
  });
}

/** The whole graph as Turtle, for a rebuild: the prefixes, then each subject. Chunks, in order. */
export function* graphTurtle(prefixMap: Map<string, string>, subjects: Iterable<TurtleSubject>): Generator<string> {
  yield serializePrefixes(prefixMap);
  for (const s of subjects) yield "\n" + subjectToTurtle(s);
}
