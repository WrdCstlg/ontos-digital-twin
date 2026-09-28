import type {
  OntologyClass,
  OntologyModule,
  OntologyProperty,
  KgNode,
  KgEdge,
} from "@db/schema";

export const BASE_ONTOLOGY_URI = "https://ontos.dev/ontology";
export const BASE_RESOURCE_URI = "https://ontos.dev/resource";

export type ShaclConstraintJson = {
  path: string;
  minCount?: number;
  maxCount?: number;
  datatype?: string;
  class?: string;
  pattern?: string;
  severity?: "Violation" | "Warning" | "Info";
  message?: string;
  sparql?: string;
};

export type ClassShaclJson = {
  shape?: string;
  constraints?: ShaclConstraintJson[];
};

/**
 * Escapes characters for W3C RDF Turtle string literals ("...").
 */
export function escapeTurtleLiteral(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Builds the standard prefix mapping for Ontos workspaces.
 */
export function buildPrefixMap(modules: OntologyModule[] = []): Map<string, string> {
  const map = new Map<string, string>();
  map.set("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#");
  map.set("rdfs", "http://www.w3.org/2000/01/rdf-schema#");
  map.set("owl", "http://www.w3.org/2002/07/owl#");
  map.set("xsd", "http://www.w3.org/2001/XMLSchema#");
  map.set("sh", "http://www.w3.org/ns/shacl#");

  // Add default core Ontos prefixes
  const defaults: Record<string, string> = {
    fin: `${BASE_ONTOLOGY_URI}/fin/`,
    hr: `${BASE_ONTOLOGY_URI}/hr/`,
    lgl: `${BASE_ONTOLOGY_URI}/lgl/`,
    log: `${BASE_ONTOLOGY_URI}/log/`,
    cmp: `${BASE_ONTOLOGY_URI}/cmp/`,
  };
  for (const [k, v] of Object.entries(defaults)) {
    map.set(k, v);
  }

  for (const m of modules) {
    if (m.prefix) {
      map.set(m.prefix, `${BASE_ONTOLOGY_URI}/${m.prefix}/`);
    }
  }
  return map;
}

/** A local name Turtle takes after a prefix: letters, digits, _ - . inside, and not ending in a dot. */
const PLAIN_LOCAL_NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;

/**
 * Formats an IRI to a valid Turtle representation.
 * - Full URLs become `<https://...>`
 * - A prefixed name stays one (`hr:Person`) only when the document declares its
 *   prefix and Turtle takes its local name. Otherwise it becomes the full IRI
 *   (`hr:Person/E-0001` becomes `<https://ontos.dev/ontology/hr/Person/E-0001>`):
 *   an undeclared prefix makes the engine refuse the whole document.
 */
export function formatIri(iri: string, prefixMap: Map<string, string>): string {
  if (!iri) return "<https://ontos.dev/blank>";
  const colonIdx = iri.indexOf(":");
  if (colonIdx > 0 && !iri.startsWith("http://") && !iri.startsWith("https://")) {
    const prefix = iri.slice(0, colonIdx);
    const local = iri.slice(colonIdx + 1);
    if (prefixMap.has(prefix) && PLAIN_LOCAL_NAME.test(local)) return `${prefix}:${local}`;
  }
  return `<${expandIri(iri, prefixMap)}>`;
}

/**
 * The full IRI `iri` names, as formatIri writes it: a prefixed name in its
 * declared namespace, or under Ontos's base for a prefix nobody declared; a
 * bare name as an Ontos resource. What the engine reports (a SHACL focus
 * node, say) is matched against this.
 */
export function expandIri(iri: string, prefixMap: Map<string, string>): string {
  if (iri.startsWith("http://") || iri.startsWith("https://")) return iri;
  const colonIdx = iri.indexOf(":");
  if (colonIdx > 0) {
    const prefix = iri.slice(0, colonIdx);
    return `${prefixMap.get(prefix) ?? `${BASE_ONTOLOGY_URI}/${prefix}/`}${iri.slice(colonIdx + 1)}`;
  }
  return `${BASE_RESOURCE_URI}/${iri}`;
}

/**
 * Each module's key, and the prefix it declares. A node's property stored
 * without a prefix is its module's: `amount` on a node of module `finance` is
 * `fin:amount`, the IRI the module's properties and shapes name.
 */
export function modulePrefixes(modules: Pick<OntologyModule, "key" | "prefix">[]): Map<string, string> {
  return new Map(modules.filter((m) => m.prefix).map((m) => [m.key, m.prefix]));
}

/**
 * Serializes standard header prefixes into Turtle.
 */
export function serializePrefixes(prefixMap: Map<string, string>): string {
  const lines: string[] = [];
  for (const [prefix, uri] of prefixMap.entries()) {
    lines.push(`@prefix ${prefix}: <${uri}> .`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * One subject and what is said about it, as Turtle predicate-object pairs
 * (`a hr:Person`, `rdfs:label "Ada"`). Rendering stops here, before the
 * document, so a graph too large for one request can be cut between subjects
 * (packTurtle) and still be written as one document (subjectToTurtle).
 */
export type TurtleSubject = { subject: string; statements: string[] };

/** A subject's statements as one Turtle block: `s p1 o1 ;\n  p2 o2 .\n`. */
export function subjectToTurtle(s: TurtleSubject): string {
  return `${s.subject} ${s.statements.join(" ;\n  ")} .\n`;
}

/** An ontology module's classes and properties, one subject each. */
export function moduleSubjects(
  classes: OntologyClass[],
  properties: OntologyProperty[],
  prefixMap: Map<string, string>,
): TurtleSubject[] {
  const out: TurtleSubject[] = [];
  const classById = new Map(classes.map((c) => [c.id, c]));

  for (const c of classes) {
    const statements = [`a owl:Class`, `rdfs:label "${escapeTurtleLiteral(c.label)}"`];
    if (c.parentId) {
      const parent = classById.get(c.parentId);
      if (parent) statements.push(`rdfs:subClassOf ${formatIri(parent.iri, prefixMap)}`);
    }
    if (c.definition) statements.push(`rdfs:comment "${escapeTurtleLiteral(c.definition)}"`);
    if (c.deprecated) statements.push(`owl:deprecated true`);
    out.push({ subject: formatIri(c.iri, prefixMap), statements });
  }

  for (const p of properties) {
    const kind = p.kind === "object" ? "owl:ObjectProperty" : "owl:DatatypeProperty";
    const statements = [`a ${kind}`, `rdfs:label "${escapeTurtleLiteral(p.label)}"`];
    if (p.domainClassId) {
      const d = classById.get(p.domainClassId);
      if (d) statements.push(`rdfs:domain ${formatIri(d.iri, prefixMap)}`);
    }
    if (p.kind === "object" && p.rangeClassId) {
      const r = classById.get(p.rangeClassId);
      if (r) statements.push(`rdfs:range ${formatIri(r.iri, prefixMap)}`);
    } else if (p.kind === "datatype" && p.rangeDatatype) {
      statements.push(`rdfs:range ${p.rangeDatatype.startsWith("xsd:") ? p.rangeDatatype : `xsd:${p.rangeDatatype}`}`);
    }
    if (p.definition) statements.push(`rdfs:comment "${escapeTurtleLiteral(p.definition)}"`);
    out.push({ subject: formatIri(p.iri, prefixMap), statements });
  }
  return out;
}

/**
 * Serializes an ontology module and its classes and properties into Turtle.
 */
export function moduleToTurtle(
  mod: OntologyModule,
  classes: OntologyClass[],
  properties: OntologyProperty[],
  prefixMap: Map<string, string> = buildPrefixMap([mod]),
): string {
  const lines: string[] = [];
  lines.push(serializePrefixes(prefixMap));
  lines.push(`# =========================================================================`);
  lines.push(`# Ontos Module: ${mod.name} (${mod.key}) v${mod.version}`);
  lines.push(`# =========================================================================\n`);
  for (const s of moduleSubjects(classes, properties, prefixMap)) lines.push(subjectToTurtle(s));
  return lines.join("\n");
}

/** Each datatype property's declared range, by the IRI a node's props use it under (fin:amount → xsd:decimal). */
export type DatatypeRanges = ReadonlyMap<string, string>;

export function datatypeRanges(properties: Pick<OntologyProperty, "iri" | "kind" | "rangeDatatype">[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of properties) {
    if (p.kind !== "datatype" || !p.rangeDatatype) continue;
    out.set(p.iri, p.rangeDatatype.startsWith("xsd:") ? p.rangeDatatype : `xsd:${p.rangeDatatype}`);
  }
  return out;
}

const INTEGER = /^[+-]?\d+$/;
const DOUBLE = /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|[+-]?INF|NaN)$/;
const TZ = "(Z|[+-]\\d{2}:\\d{2})?";
/** XML Schema's lexical space for the datatypes an ontology here declares, after whitespace is collapsed. */
const LEXICAL: Record<string, RegExp> = {
  "xsd:string": /^[\s\S]*$/,
  "xsd:decimal": /^[+-]?(\d+(\.\d*)?|\.\d+)$/,
  "xsd:integer": INTEGER,
  "xsd:int": INTEGER,
  "xsd:long": INTEGER,
  "xsd:short": INTEGER,
  "xsd:nonNegativeInteger": /^\+?\d+$|^-0+$/,
  "xsd:positiveInteger": /^\+?0*[1-9]\d*$/,
  "xsd:double": DOUBLE,
  "xsd:float": DOUBLE,
  "xsd:boolean": /^(true|false|1|0)$/,
  "xsd:date": new RegExp(`^-?\\d{4,}-\\d{2}-\\d{2}${TZ}$`),
  "xsd:dateTime": new RegExp(`^-?\\d{4,}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?${TZ}$`),
  "xsd:time": new RegExp(`^\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?${TZ}$`),
  "xsd:gYear": new RegExp(`^-?\\d{4,}${TZ}$`),
  "xsd:anyURI": /^\S*$/,
};

/**
 * The literal for a value of a property with a declared range: the value
 * typed as declared, when its lexical form is one the datatype allows (the
 * form is collapsed first, as XML Schema does, except for strings). Otherwise
 * null, and the value is typed from its own shape, as it always was, so a
 * value that does not fit its declared type is still reported by SHACL.
 */
function declaredLiteral(value: unknown, declared: string | undefined): string | null {
  if (!declared || !(declared in LEXICAL) || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return null;
  const raw = String(value);
  const lexical = declared === "xsd:string" ? raw : raw.trim();
  return LEXICAL[declared].test(lexical) ? `"${escapeTurtleLiteral(lexical)}"^^${declared}` : null;
}

/**
 * Converts knowledge graph nodes and edges into Turtle instance data.
 *
 * Imports store every value as it came, a string, so without `ranges` a
 * value is typed from its shape alone: "1234.56" became xsd:string, and a
 * property declared xsd:decimal failed SHACL whatever its data. With the
 * workspace's declared ranges (datatypeRanges), a value that fits its
 * property's range is typed as declared.
 */
export function knowledgeGraphToTurtle(
  nodes: KgNode[],
  edges: KgEdge[],
  prefixMap: Map<string, string> = buildPrefixMap(),
  ranges?: DatatypeRanges,
  prefixOfModule: ReadonlyMap<string, string> = new Map(),
): string {
  const lines: string[] = [];
  lines.push(serializePrefixes(prefixMap));
  lines.push(`# =========================================================================`);
  lines.push(`# Ontos Knowledge Graph Instances (${nodes.length} nodes, ${edges.length} edges)`);
  lines.push(`# =========================================================================\n`);
  for (const s of knowledgeGraphSubjects(nodes, edges, prefixMap, ranges, prefixOfModule)) lines.push(subjectToTurtle(s));
  return lines.join("\n");
}

/** Knowledge graph nodes as knowledgeGraphToTurtle renders them, one subject each, with its outgoing links. */
export function knowledgeGraphSubjects(
  nodes: KgNode[],
  edges: KgEdge[],
  prefixMap: Map<string, string> = buildPrefixMap(),
  ranges?: DatatypeRanges,
  prefixOfModule: ReadonlyMap<string, string> = new Map(),
): TurtleSubject[] {
  const out: TurtleSubject[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Group outgoing edges by fromNodeId
  const outEdges = new Map<number, KgEdge[]>();
  for (const e of edges) {
    const list = outEdges.get(e.fromNodeId) ?? [];
    list.push(e);
    outEdges.set(e.fromNodeId, list);
  }

  for (const n of nodes) {
    const statements = [`a ${formatIri(n.classIri, prefixMap)}`];

    if (n.label) {
      statements.push(`rdfs:label "${escapeTurtleLiteral(n.label)}"`);
    }

    // Datatype property assignments from propsJson
    if (n.propsJson && typeof n.propsJson === "object") {
      const props = n.propsJson as Record<string, unknown>;
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined) continue;

        // A key without a prefix is the node's module's property, in the
        // module's namespace: its prefix, which is not always its key.
        const predIri = key.includes(":") ? key : `${prefixOfModule.get(n.moduleKey) ?? n.moduleKey}:${key}`;
        const formattedPred = formatIri(predIri, prefixMap);

        const typed = declaredLiteral(value, ranges?.get(predIri));
        if (typed) {
          statements.push(`${formattedPred} ${typed}`);
        } else if (typeof value === "number") {
          const type = Number.isInteger(value) ? "xsd:integer" : "xsd:decimal";
          statements.push(`${formattedPred} "${value}"^^${type}`);
        } else if (typeof value === "boolean") {
          statements.push(`${formattedPred} "${value}"^^xsd:boolean`);
        } else if (typeof value === "string") {
          // Check for ISO date pattern
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            statements.push(`${formattedPred} "${value}"^^xsd:date`);
          } else {
            statements.push(`${formattedPred} "${escapeTurtleLiteral(value)}"^^xsd:string`);
          }
        }
      }
    }

    // Object relationship edges
    const related = outEdges.get(n.id) ?? [];
    for (const e of related) {
      const target = nodeById.get(e.toNodeId);
      if (target) {
        statements.push(`${formatIri(e.predicateIri, prefixMap)} ${formatIri(target.iri, prefixMap)}`);
      }
    }

    out.push({ subject: formatIri(n.iri, prefixMap), statements });
  }
  return out;
}

/** Bytes `text` takes inside a JSON string: UTF-8, after escaping, without the quotes. */
function jsonBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
}

/**
 * Cuts a graph into Turtle documents that each fit one request to the engine,
 * which refuses a body over 2 MiB. Every document declares the prefixes, and
 * none takes more than `maxBytes` inside a JSON string, as the request carries
 * it. Documents break between subjects; a subject too large for one document
 * is split between its statements, repeating the subject, which says the same
 * triples. The documents together hold exactly the triples of
 * `prefixes + subjects`, in order. Throws if a single statement cannot fit:
 * leaving it out would load a graph that is not the workspace's.
 */
export function packTurtle(prefixMap: Map<string, string>, subjects: TurtleSubject[], maxBytes: number): string[] {
  const header = serializePrefixes(prefixMap);
  // Each block follows a newline, 2 bytes escaped.
  const room = maxBytes - jsonBytes(header);
  if (room <= 0) throw new Error(`The prefixes alone take more than one request to the engine can carry (${maxBytes} bytes)`);
  const docs: string[] = [];
  let blocks: string[] = [];
  let used = 0;
  const flush = () => {
    if (blocks.length > 0) docs.push([header, ...blocks].join("\n"));
    blocks = [];
    used = 0;
  };
  const add = (block: string, bytes: number) => {
    if (used + bytes > room) flush();
    blocks.push(block);
    used += bytes;
  };

  for (const s of subjects) {
    const whole = subjectToTurtle(s);
    const wholeBytes = jsonBytes(whole) + 2;
    if (wholeBytes <= room) {
      add(whole, wholeBytes);
      continue;
    }
    // Too large for any document: one block per run of statements that fits.
    // A block's size is the sum of its pieces', escaping being per character.
    const base = jsonBytes(`${s.subject} `) + jsonBytes(" .\n") + 2;
    const separator = jsonBytes(" ;\n  ");
    let part: string[] = [];
    let partBytes = 0;
    for (const statement of s.statements) {
      const bytes = jsonBytes(statement);
      if (base + bytes > room) {
        throw new Error(
          `${s.subject} has a statement of ${bytes} bytes, more than one request to the engine can carry (${maxBytes} bytes with the prefixes)`,
        );
      }
      if (part.length > 0 && base + partBytes + separator + bytes > room) {
        add(subjectToTurtle({ subject: s.subject, statements: part }), base + partBytes);
        part = [];
        partBytes = 0;
      }
      partBytes += (part.length > 0 ? separator : 0) + bytes;
      part.push(statement);
    }
    if (part.length > 0) add(subjectToTurtle({ subject: s.subject, statements: part }), base + partBytes);
  }
  flush();
  return docs;
}

/**
 * Compiles class shaclJson declarations into W3C SHACL Turtle shapes.
 */
export function shaclJsonToTurtle(
  classes: OntologyClass[],
  prefixMap: Map<string, string> = buildPrefixMap(),
): string {
  const lines: string[] = [];
  lines.push(serializePrefixes(prefixMap));
  lines.push(`# =========================================================================`);
  lines.push(`# W3C SHACL Shapes Generated from Ontos Metadata`);
  lines.push(`# =========================================================================\n`);

  let shapeCount = 0;

  for (const c of classes) {
    if (!c.shaclJson || typeof c.shaclJson !== "object") continue;
    const config = c.shaclJson as ClassShaclJson;
    const constraints = config.constraints ?? [];
    if (constraints.length === 0) continue;

    const shapeName = config.shape ?? `${c.iri}Shape`;
    const shapeIri = formatIri(shapeName, prefixMap);
    const targetClassIri = formatIri(c.iri, prefixMap);

    lines.push(`${shapeIri} a sh:NodeShape ;`);
    lines.push(`  sh:targetClass ${targetClassIri} ;`);

    for (let i = 0; i < constraints.length; i++) {
      const cst = constraints[i];
      const isLast = i === constraints.length - 1;
      const pathIri = formatIri(cst.path, prefixMap);

      lines.push(`  sh:property [`);
      lines.push(`    sh:path ${pathIri} ;`);

      if (typeof cst.minCount === "number") {
        lines.push(`    sh:minCount ${cst.minCount} ;`);
      }
      if (typeof cst.maxCount === "number") {
        lines.push(`    sh:maxCount ${cst.maxCount} ;`);
      }
      if (cst.datatype) {
        const dt = cst.datatype.startsWith("xsd:") ? cst.datatype : `xsd:${cst.datatype}`;
        lines.push(`    sh:datatype ${dt} ;`);
      }
      if (cst.class) {
        lines.push(`    sh:class ${formatIri(cst.class, prefixMap)} ;`);
      }
      if (cst.pattern) {
        lines.push(`    sh:pattern "${escapeTurtleLiteral(cst.pattern)}" ;`);
      }
      if (cst.severity) {
        lines.push(`    sh:severity sh:${cst.severity} ;`);
      }
      if (cst.message) {
        lines.push(`    sh:message "${escapeTurtleLiteral(cst.message)}" ;`);
      }

      // Close property blank node
      lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, "");
      lines.push(`  ]${isLast ? " ." : " ;"}`);
    }
    lines.push("");
    shapeCount++;
  }

  if (shapeCount === 0) {
    return "";
  }

  return lines.join("\n");
}
