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

/**
 * Formats an IRI to a valid Turtle representation.
 * - Full URLs become `<https://...>`
 * - Prefixed names with slashes (e.g. `hr:Person/E-0001`) become `<https://ontos.dev/ontology/hr/Person/E-0001>`
 * - Clean prefixed names (e.g. `hr:Person`) stay `hr:Person`
 */
export function formatIri(iri: string, prefixMap: Map<string, string>): string {
  if (!iri) return "<https://ontos.dev/blank>";
  if (iri.startsWith("http://") || iri.startsWith("https://")) {
    return `<${iri}>`;
  }
  const colonIdx = iri.indexOf(":");
  if (colonIdx > 0) {
    const prefix = iri.slice(0, colonIdx);
    const local = iri.slice(colonIdx + 1);
    const baseUri = prefixMap.get(prefix) ?? `${BASE_ONTOLOGY_URI}/${prefix}/`;
    if (local.includes("/") || /[^a-zA-Z0-9_\-.]/.test(local)) {
      return `<${baseUri}${local}>`;
    }
    return `${prefix}:${local}`;
  }
  return `<${BASE_RESOURCE_URI}/${iri}>`;
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

  const classById = new Map(classes.map((c) => [c.id, c]));

  for (const c of classes) {
    const classIriFormatted = formatIri(c.iri, prefixMap);
    lines.push(`${classIriFormatted} a owl:Class ;`);
    lines.push(`  rdfs:label "${escapeTurtleLiteral(c.label)}" ;`);

    if (c.parentId) {
      const parent = classById.get(c.parentId);
      if (parent) {
        lines.push(`  rdfs:subClassOf ${formatIri(parent.iri, prefixMap)} ;`);
      }
    }
    if (c.definition) {
      lines.push(`  rdfs:comment "${escapeTurtleLiteral(c.definition)}" ;`);
    }
    if (c.deprecated) {
      lines.push(`  owl:deprecated true ;`);
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, " .\n");
  }

  for (const p of properties) {
    const propIriFormatted = formatIri(p.iri, prefixMap);
    const kind = p.kind === "object" ? "owl:ObjectProperty" : "owl:DatatypeProperty";
    lines.push(`${propIriFormatted} a ${kind} ;`);
    lines.push(`  rdfs:label "${escapeTurtleLiteral(p.label)}" ;`);

    if (p.domainClassId) {
      const d = classById.get(p.domainClassId);
      if (d) lines.push(`  rdfs:domain ${formatIri(d.iri, prefixMap)} ;`);
    }
    if (p.kind === "object" && p.rangeClassId) {
      const r = classById.get(p.rangeClassId);
      if (r) lines.push(`  rdfs:range ${formatIri(r.iri, prefixMap)} ;`);
    } else if (p.kind === "datatype" && p.rangeDatatype) {
      const dt = p.rangeDatatype.startsWith("xsd:") ? p.rangeDatatype : `xsd:${p.rangeDatatype}`;
      lines.push(`  rdfs:range ${dt} ;`);
    }
    if (p.definition) {
      lines.push(`  rdfs:comment "${escapeTurtleLiteral(p.definition)}" ;`);
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, " .\n");
  }

  return lines.join("\n");
}

/**
 * Converts knowledge graph nodes and edges into Turtle instance data.
 */
export function knowledgeGraphToTurtle(
  nodes: KgNode[],
  edges: KgEdge[],
  prefixMap: Map<string, string> = buildPrefixMap(),
): string {
  const lines: string[] = [];
  lines.push(serializePrefixes(prefixMap));
  lines.push(`# =========================================================================`);
  lines.push(`# Ontos Knowledge Graph Instances (${nodes.length} nodes, ${edges.length} edges)`);
  lines.push(`# =========================================================================\n`);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Group outgoing edges by fromNodeId
  const outEdges = new Map<number, KgEdge[]>();
  for (const e of edges) {
    const list = outEdges.get(e.fromNodeId) ?? [];
    list.push(e);
    outEdges.set(e.fromNodeId, list);
  }

  for (const n of nodes) {
    const subjectIri = formatIri(n.iri, prefixMap);
    const typeIri = formatIri(n.classIri, prefixMap);
    lines.push(`${subjectIri} a ${typeIri} ;`);

    if (n.label) {
      lines.push(`  rdfs:label "${escapeTurtleLiteral(n.label)}" ;`);
    }

    // Datatype property assignments from propsJson
    if (n.propsJson && typeof n.propsJson === "object") {
      const props = n.propsJson as Record<string, unknown>;
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined) continue;

        // Resolve predicate: if key is already prefixed use it, else prefix with node's moduleKey
        const predIri = key.includes(":") ? key : `${n.moduleKey}:${key}`;
        const formattedPred = formatIri(predIri, prefixMap);

        if (typeof value === "number") {
          const type = Number.isInteger(value) ? "xsd:integer" : "xsd:decimal";
          lines.push(`  ${formattedPred} "${value}"^^${type} ;`);
        } else if (typeof value === "boolean") {
          lines.push(`  ${formattedPred} "${value}"^^xsd:boolean ;`);
        } else if (typeof value === "string") {
          // Check for ISO date pattern
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            lines.push(`  ${formattedPred} "${value}"^^xsd:date ;`);
          } else {
            lines.push(`  ${formattedPred} "${escapeTurtleLiteral(value)}"^^xsd:string ;`);
          }
        }
      }
    }

    // Object relationship edges
    const related = outEdges.get(n.id) ?? [];
    for (const e of related) {
      const target = nodeById.get(e.toNodeId);
      if (target) {
        const predIri = formatIri(e.predicateIri, prefixMap);
        const targetIri = formatIri(target.iri, prefixMap);
        lines.push(`  ${predIri} ${targetIri} ;`);
      }
    }

    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, " .\n");
  }

  return lines.join("\n");
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
