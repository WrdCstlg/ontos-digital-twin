import type {
  OntologyClass,
  OntologyModule,
  OntologyProperty,
} from "@db/schema";

export type ExportFormat = "turtle" | "owl" | "jsonld" | "rdfxml";

type Ctx = {
  module: OntologyModule;
  classes: OntologyClass[];
  properties: OntologyProperty[];
};

const BASE = "https://ontos.dev/ontology";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function classById(ctx: Ctx, id: number | null) {
  return ctx.classes.find((c) => c.id === id) ?? null;
}

function fullIri(iri: string) {
  return iri.includes(":") ? `${BASE}/${iri.replace(":", "/")}` : iri;
}

export function serializeModule(ctx: Ctx, format: ExportFormat): string {
  switch (format) {
    case "turtle":
      return toTurtle(ctx);
    case "jsonld":
      return toJsonLd(ctx);
    case "owl":
      return toRdfXml(ctx, true);
    case "rdfxml":
      return toRdfXml(ctx, false);
  }
}

function prefixes(ctx: Ctx) {
  const set = new Map<string, string>();
  set.set(ctx.module.prefix, `${BASE}/${ctx.module.prefix}/`);
  for (const c of ctx.classes) {
    const p = c.iri.split(":")[0];
    if (p && !set.has(p)) set.set(p, `${BASE}/${p}/`);
  }
  for (const p of ctx.properties) {
    const pre = p.iri.split(":")[0];
    if (pre && !set.has(pre)) set.set(pre, `${BASE}/${pre}/`);
    const d = classById(ctx, p.domainClassId);
    const r = classById(ctx, p.rangeClassId);
    for (const cc of [d, r]) {
      if (cc) {
        const pp = cc.iri.split(":")[0];
        if (pp && !set.has(pp)) set.set(pp, `${BASE}/${pp}/`);
      }
    }
  }
  return set;
}

function toTurtle(ctx: Ctx): string {
  const pre = prefixes(ctx);
  const lines: string[] = [];
  for (const [p, ns] of pre) lines.push(`@prefix ${p}: <${ns}> .`);
  lines.push(
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    ``,
    `# Module: ${ctx.module.name} v${ctx.module.version}`,
    ``,
  );
  for (const c of ctx.classes) {
    const parent = classById(ctx, c.parentId);
    lines.push(`${c.iri} a owl:Class ;`);
    lines.push(`  rdfs:label "${esc(c.label)}" ;`);
    if (parent) lines.push(`  rdfs:subClassOf ${parent.iri} ;`);
    if (c.definition) lines.push(`  rdfs:comment "${esc(c.definition)}" ;`);
    if (c.deprecated) lines.push(`  owl:deprecated true ;`);
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, " .");
    lines.push(``);
  }
  for (const p of ctx.properties) {
    const d = classById(ctx, p.domainClassId);
    const r = classById(ctx, p.rangeClassId);
    lines.push(
      `${p.iri} a ${p.kind === "object" ? "owl:ObjectProperty" : "owl:DatatypeProperty"} ;`,
    );
    lines.push(`  rdfs:label "${esc(p.label)}" ;`);
    if (d) lines.push(`  rdfs:domain ${d.iri} ;`);
    if (p.kind === "object" && r) lines.push(`  rdfs:range ${r.iri} ;`);
    if (p.kind === "datatype" && p.rangeDatatype)
      lines.push(`  rdfs:range ${p.rangeDatatype} ;`);
    if (p.definition) lines.push(`  rdfs:comment "${esc(p.definition)}" ;`);
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, " .");
    lines.push(``);
  }
  return lines.join("\n");
}

function toJsonLd(ctx: Ctx): string {
  const context: Record<string, string> = {
    owl: "http://www.w3.org/2002/07/owl#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };
  for (const [p, ns] of prefixes(ctx)) context[p] = ns;
  const graph: unknown[] = [];
  for (const c of ctx.classes) {
    const parent = classById(ctx, c.parentId);
    graph.push({
      "@id": c.iri,
      "@type": "owl:Class",
      "rdfs:label": c.label,
      ...(parent ? { "rdfs:subClassOf": { "@id": parent.iri } } : {}),
      ...(c.definition ? { "rdfs:comment": c.definition } : {}),
      ...(c.deprecated ? { "owl:deprecated": true } : {}),
    });
  }
  for (const p of ctx.properties) {
    const d = classById(ctx, p.domainClassId);
    const r = classById(ctx, p.rangeClassId);
    graph.push({
      "@id": p.iri,
      "@type": p.kind === "object" ? "owl:ObjectProperty" : "owl:DatatypeProperty",
      "rdfs:label": p.label,
      ...(d ? { "rdfs:domain": { "@id": d.iri } } : {}),
      ...(p.kind === "object" && r ? { "rdfs:range": { "@id": r.iri } } : {}),
      ...(p.kind === "datatype" && p.rangeDatatype
        ? { "rdfs:range": { "@id": p.rangeDatatype } }
        : {}),
      ...(p.definition ? { "rdfs:comment": p.definition } : {}),
    });
  }
  return JSON.stringify(
    {
      "@context": context,
      "@id": `${BASE}/${ctx.module.prefix}/`,
      moduleVersion: ctx.module.version,
      "@graph": graph,
    },
    null,
    2,
  );
}

function toRdfXml(ctx: Ctx, owlFlavored: boolean): string {
  const pre = prefixes(ctx);
  const attrs = [...pre.entries()]
    .map(([p, ns]) => `  xmlns:${p}="${ns}"`)
    .join("\n");
  const body: string[] = [];
  for (const c of ctx.classes) {
    const parent = classById(ctx, c.parentId);
    body.push(`  <owl:Class rdf:about="${fullIri(c.iri)}">`);
    body.push(`    <rdfs:label>${esc(c.label)}</rdfs:label>`);
    if (parent)
      body.push(`    <rdfs:subClassOf rdf:resource="${fullIri(parent.iri)}"/>`);
    if (c.definition)
      body.push(`    <rdfs:comment>${esc(c.definition)}</rdfs:comment>`);
    if (owlFlavored && c.deprecated)
      body.push(`    <owl:deprecated rdf:datatype="http://www.w3.org/2001/XMLSchema#boolean">true</owl:deprecated>`);
    body.push(`  </owl:Class>`);
  }
  for (const p of ctx.properties) {
    const d = classById(ctx, p.domainClassId);
    const r = classById(ctx, p.rangeClassId);
    const tag = p.kind === "object" ? "owl:ObjectProperty" : "owl:DatatypeProperty";
    body.push(`  <${tag} rdf:about="${fullIri(p.iri)}">`);
    body.push(`    <rdfs:label>${esc(p.label)}</rdfs:label>`);
    if (d) body.push(`    <rdfs:domain rdf:resource="${fullIri(d.iri)}"/>`);
    if (p.kind === "object" && r)
      body.push(`    <rdfs:range rdf:resource="${fullIri(r.iri)}"/>`);
    if (p.kind === "datatype" && p.rangeDatatype)
      body.push(
        `    <rdfs:range rdf:resource="http://www.w3.org/2001/XMLSchema#${p.rangeDatatype.replace(/^xsd:/, "")}"/>`,
      );
    body.push(`  </${tag}>`);
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`,
    `  xmlns:owl="http://www.w3.org/2002/07/owl#"`,
    `  xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"`,
    attrs,
    `>`,
    `  <!-- ${esc(ctx.module.name)} v${ctx.module.version} (${owlFlavored ? "OWL 2 DL" : "RDF/XML"}) -->`,
    ...body,
    `</rdf:RDF>`,
    ``,
  ].join("\n");
}
