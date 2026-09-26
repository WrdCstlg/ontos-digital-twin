import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { actionTypes, ontologyClasses, ontologyModules, ontologyProperties } from "@db/schema";
import { actionDefinitionSchema, type ActionParameter } from "@contracts/actions";
import { getDb } from "../../queries/connection";
import { canonicalize } from "../audit";

/**
 * The workspace's ontology as the public API presents it: object types with
 * their properties and links (inherited ones included), and the active action
 * types. The OpenAPI document and the TypeScript SDK are both generated from
 * this, and its fingerprint tells a client whether the ontology it was built
 * against is still the one the server has.
 */

export type ScalarType = "string" | "number" | "integer" | "boolean" | "date" | "dateTime";

export type PropertyModel = {
  iri: string;
  /** The name it has in the API: the IRI's local name, e.g. "fullName". */
  key: string;
  label: string;
  type: ScalarType;
  required: boolean;
  multiple: boolean;
  description: string | null;
};

export type LinkModel = {
  iri: string;
  key: string;
  label: string;
  /** The class it points to, when the ontology names one. */
  target: string | null;
  required: boolean;
  multiple: boolean;
  description: string | null;
};

export type ObjectTypeModel = {
  iri: string;
  /** PascalCase name for code, e.g. "HrPerson". */
  apiName: string;
  prefix: string;
  localName: string;
  module: { key: string; name: string; prefix: string };
  label: string;
  description: string | null;
  parent: string | null;
  deprecated: boolean;
  properties: PropertyModel[];
  links: LinkModel[];
};

export type ActionTypeModel = {
  key: string;
  apiName: string;
  displayName: string;
  description: string | null;
  module: string;
  minRole: string;
  version: number;
  parameters: ActionParameter[];
};

export type OntologyModel = {
  workspace: { id: number; name: string; slug: string };
  version: string;
  modules: { key: string; name: string; prefix: string; version: string; status: string }[];
  objectTypes: ObjectTypeModel[];
  actionTypes: ActionTypeModel[];
};

export function localName(iri: string): string {
  const colon = iri.indexOf(":");
  const tail = colon >= 0 ? iri.slice(colon + 1) : iri;
  return tail.split(/[/#]/).filter(Boolean).pop() ?? tail;
}

/** "hr:Person" → "HrPerson"; "renew-contract" → "RenewContract". */
export function pascal(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split(/[^A-Za-z0-9]+/))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

function scalarOf(datatype: string | null): ScalarType {
  switch ((datatype ?? "").replace(/^xsd:/, "")) {
    case "decimal":
    case "double":
    case "float":
      return "number";
    case "integer":
    case "int":
    case "long":
    case "short":
    case "nonNegativeInteger":
    case "positiveInteger":
      return "integer";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "dateTime":
      return "dateTime";
    default:
      return "string";
  }
}

function cardinality(c: string | null): { required: boolean; multiple: boolean } {
  const [min, max] = (c ?? "0..1").split("..");
  return { required: min !== undefined && min !== "0", multiple: max === "*" || (max !== undefined && Number(max) > 1) };
}

export async function loadOntologyModel(workspace: { id: number; name: string; slug: string }): Promise<OntologyModel> {
  const db = getDb();
  const modules = await db.select().from(ontologyModules).where(eq(ontologyModules.workspaceId, workspace.id)).orderBy(ontologyModules.key);
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const classes = (
    await db
      .select({ cls: ontologyClasses })
      .from(ontologyClasses)
      .innerJoin(ontologyModules, eq(ontologyClasses.moduleId, ontologyModules.id))
      .where(eq(ontologyModules.workspaceId, workspace.id))
  ).map((r) => r.cls);
  const props = (
    await db
      .select({ prop: ontologyProperties })
      .from(ontologyProperties)
      .innerJoin(ontologyModules, eq(ontologyProperties.moduleId, ontologyModules.id))
      .where(eq(ontologyModules.workspaceId, workspace.id))
  ).map((r) => r.prop);
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Each class's own properties and links, before inheritance.
  const own = new Map<number, { properties: PropertyModel[]; links: LinkModel[] }>();
  for (const p of props) {
    if (p.domainClassId == null) continue;
    const entry = own.get(p.domainClassId) ?? { properties: [], links: [] };
    const { required, multiple } = cardinality(p.cardinality);
    if (p.kind === "datatype") {
      entry.properties.push({ iri: p.iri, key: localName(p.iri), label: p.label, type: scalarOf(p.rangeDatatype), required, multiple, description: p.definition ?? null });
    } else {
      const target = p.rangeClassId != null ? classById.get(p.rangeClassId)?.iri ?? null : null;
      entry.links.push({ iri: p.iri, key: localName(p.iri), label: p.label, target, required, multiple, description: p.definition ?? null });
    }
    own.set(p.domainClassId, entry);
  }

  const objectTypes: ObjectTypeModel[] = [];
  for (const c of classes) {
    const m = moduleById.get(c.moduleId);
    if (!m) continue;
    const properties = new Map<string, PropertyModel>();
    const links = new Map<string, LinkModel>();
    // Own first, then each ancestor's: a nearer definition wins a name.
    const seen = new Set<number>();
    for (let cur: typeof c | undefined = c; cur && !seen.has(cur.id); cur = cur.parentId != null ? classById.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      for (const p of own.get(cur.id)?.properties ?? []) if (!properties.has(p.key)) properties.set(p.key, p);
      for (const l of own.get(cur.id)?.links ?? []) if (!links.has(l.key)) links.set(l.key, l);
    }
    const prefix = c.iri.includes(":") ? c.iri.slice(0, c.iri.indexOf(":")) : m.prefix;
    objectTypes.push({
      iri: c.iri,
      apiName: pascal(prefix, localName(c.iri)),
      prefix,
      localName: localName(c.iri),
      module: { key: m.key, name: m.name, prefix: m.prefix },
      label: c.label,
      description: c.definition ?? null,
      parent: c.parentId != null ? classById.get(c.parentId)?.iri ?? null : null,
      deprecated: c.deprecated,
      properties: [...properties.values()].sort((a, b) => a.key.localeCompare(b.key)),
      links: [...links.values()].sort((a, b) => a.key.localeCompare(b.key)),
    });
  }
  objectTypes.sort((a, b) => a.iri.localeCompare(b.iri));

  const actions = await db
    .select({ at: actionTypes, module: ontologyModules })
    .from(actionTypes)
    .innerJoin(ontologyModules, eq(actionTypes.moduleId, ontologyModules.id))
    .where(eq(actionTypes.workspaceId, workspace.id))
    .orderBy(actionTypes.key);
  const actionTypeModels: ActionTypeModel[] = [];
  for (const { at, module } of actions) {
    if (at.status !== "active") continue;
    const def = actionDefinitionSchema.safeParse(at.definitionJson);
    if (!def.success) continue;
    actionTypeModels.push({
      key: at.key,
      apiName: pascal(at.key),
      displayName: at.displayName,
      description: at.description,
      module: module.key,
      minRole: at.minRole,
      version: at.version,
      parameters: def.data.parameters,
    });
  }

  const body = {
    modules: modules.map((m) => ({ key: m.key, name: m.name, prefix: m.prefix, version: m.version, status: m.status })),
    objectTypes,
    actionTypes: actionTypeModels,
  };
  const version = createHash("sha256").update(canonicalize(body)).digest("hex").slice(0, 12);
  return { workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug }, version, ...body };
}

/** The namespaces an object's short property keys stand for: its module key and prefix. */
export function namespacesOf(model: OntologyModel, moduleKey: string): string[] {
  const m = model.modules.find((x) => x.key === moduleKey);
  return [...new Set([moduleKey, ...(m ? [m.prefix] : [])])];
}

/** An object's properties under their API names: a prefixed key in the object's own namespace loses its prefix. */
export function apiProperties(props: Record<string, unknown>, namespaces: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const colon = k.indexOf(":");
    const key = colon > 0 && namespaces.includes(k.slice(0, colon)) ? k.slice(colon + 1) : k;
    if (!(key in out) || colon < 0) out[key] = v;
  }
  return out;
}
