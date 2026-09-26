import type { ActionParameter } from "@contracts/actions";
import type { ActionTypeModel, ObjectTypeModel, OntologyModel, ScalarType } from "./model";

/**
 * The OpenAPI 3.1 document of a workspace's Ontology API, generated from its
 * ontology: a schema and two paths per object type, and a typed request per
 * action type.
 */

type Schema = Record<string, unknown>;

export function scalarSchema(t: ScalarType): Schema {
  switch (t) {
    case "number":
      return { type: "number" };
    case "integer":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date" };
    case "dateTime":
      return { type: "string", format: "date-time" };
    default:
      return { type: "string" };
  }
}

export function parameterSchema(p: ActionParameter): Schema {
  const base: Schema = { title: p.label, ...(p.description ? { description: p.description } : {}) };
  switch (p.type) {
    case "string":
      return { ...base, type: "string", ...(p.maxLength ? { maxLength: p.maxLength } : {}) };
    case "number":
      return {
        ...base,
        type: p.integer ? "integer" : "number",
        ...(p.min !== undefined ? { minimum: p.min } : {}),
        ...(p.max !== undefined ? { maximum: p.max } : {}),
      };
    case "boolean":
      return { ...base, type: "boolean" };
    case "date":
      return { ...base, type: "string", format: "date" };
    case "enum":
      return { ...base, type: "string", enum: p.options };
    case "object":
      return { ...base, type: "string", description: `The IRI of a ${p.classIri}, or of a subclass.${p.description ? ` ${p.description}` : ""}`, "x-ontos-object-type": p.classIri };
  }
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const errors = {
  "400": json(ref("Error"), "The request is not valid"),
  "401": json(ref("Error"), "No valid API token or session"),
  "403": json(ref("Error"), "The token or role may not do this"),
  "404": json(ref("Error"), "Not found"),
  "429": json(ref("Error"), "Too many requests; retry after the retry-after header's seconds"),
  "503": json(ref("Error"), "The session or token could not be checked just now; retry"),
};

function objectTypeSchema(t: ObjectTypeModel): Schema {
  const properties: Schema = {};
  const required: string[] = [];
  for (const p of t.properties) {
    const s = scalarSchema(p.type);
    properties[p.key] = { ...(p.multiple ? { type: "array", items: s } : s), title: p.label, ...(p.description ? { description: p.description } : {}), "x-ontos-iri": p.iri };
    if (p.required) required.push(p.key);
  }
  const links: Schema = {};
  for (const l of t.links) {
    links[l.key] = {
      type: "array",
      items: { type: "string" },
      title: l.label,
      description: `IRIs of the objects this links to${l.target ? ` (${l.target})` : ""}.${l.description ? ` ${l.description}` : ""}`,
      "x-ontos-iri": l.iri,
      ...(l.target ? { "x-ontos-object-type": l.target } : {}),
    };
  }
  return {
    type: "object",
    title: t.label,
    ...(t.description ? { description: t.description } : {}),
    "x-ontos-iri": t.iri,
    required: ["iri", "objectType", "label", "properties", "links", "source", "createdAt", "updatedAt"],
    properties: {
      iri: { type: "string" },
      objectType: { type: "string", description: `${t.iri}, or one of its subclasses` },
      label: { type: "string" },
      properties: {
        type: "object",
        properties,
        // The ontology declares what is typed here; objects may carry more.
        additionalProperties: true,
        ...(required.length ? { "x-ontos-required": required } : {}),
      },
      links: { type: "object", properties: links, additionalProperties: { type: "array", items: { type: "string" } } },
      source: ref("Source"),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };
}

function actionParamsSchema(a: ActionTypeModel): Schema {
  const properties: Schema = {};
  for (const p of a.parameters) properties[p.name] = parameterSchema(p);
  const required = a.parameters.filter((p) => p.required).map((p) => p.name);
  return { type: "object", title: `${a.displayName}: parameters`, properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export function buildOpenApi(model: OntologyModel): Record<string, unknown> {
  const schemas: Schema = {
    Error: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: { code: { type: "string" }, message: { type: "string" }, problems: { type: "array", items: ref("Problem") } },
        },
      },
    },
    Problem: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, path: { type: "string" } } },
    Source: {
      type: "object",
      description: "Where the object came from: the mapping that imported it, and the action submission that last changed it.",
      properties: { mappingId: { type: ["integer", "null"] }, submissionId: { type: ["integer", "null"] } },
    },
    Criterion: { type: "object", properties: { index: { type: "integer" }, message: { type: "string" }, passed: { type: "boolean" }, detail: { type: "string" } } },
    Changes: {
      type: "object",
      description: "What a submission changes, or changed.",
      properties: {
        created: { type: "array", items: { type: "object", properties: { iri: { type: "string" }, classIri: { type: "string" }, label: { type: "string" } } } },
        modified: { type: "array", items: { type: "object", properties: { iri: { type: "string" }, set: { type: "object" }, unset: { type: "array", items: { type: "string" } } } } },
        deleted: { type: "array", items: { type: "object", properties: { iri: { type: "string" }, label: { type: "string" } } } },
        linksAdded: { type: "array", items: ref("Link") },
        linksRemoved: { type: "array", items: ref("Link") },
      },
    },
    Link: { type: "object", properties: { from: { type: "string" }, predicate: { type: "string" }, to: { type: "string" } } },
    Shacl: { type: "object", properties: { status: { type: "string", enum: ["conforms", "violations", "no_shapes", "unavailable", "skipped"] }, violations: { type: "array", items: { type: "object" } } } },
    Preview: {
      type: "object",
      properties: {
        canApply: { type: "boolean" },
        problems: { type: "array", items: ref("Problem") },
        criteria: { type: "array", items: ref("Criterion") },
        changes: ref("Changes"),
        shacl: ref("Shacl"),
      },
    },
    Submission: {
      type: "object",
      properties: {
        id: { type: "integer" },
        actionKey: { type: "string" },
        actionVersion: { type: "integer" },
        status: { type: "string", enum: ["applied", "rejected"] },
        submittedBy: { type: "string" },
        params: { type: "object" },
        changes: ref("Changes"),
        problems: { type: "array", items: ref("Problem") },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    SubmitResult: {
      type: "object",
      description: "An applied or a rejected submission. A rejection is recorded, and is an answer, not an error.",
      properties: { submission: ref("Submission"), problems: { type: "array", items: ref("Problem") }, criteria: { type: "array", items: ref("Criterion") }, changes: ref("Changes"), shacl: ref("Shacl") },
    },
  };
  const paths: Schema = {
    "/ontology": {
      get: { operationId: "getOntology", summary: "The ontology: modules, object types with their properties and links, and action types", tags: ["Ontology"], responses: { "200": json({ type: "object" }), ...errors } },
    },
    "/openapi.json": {
      get: { operationId: "getOpenApi", summary: "This document, generated from the ontology", tags: ["Ontology"], responses: { "200": json({ type: "object" }), ...errors } },
    },
    "/sdk.ts": {
      get: {
        operationId: "getTypeScriptSdk",
        summary: "A TypeScript client generated from the ontology: one file, no dependencies",
        tags: ["Ontology"],
        responses: { "200": { description: "OK", content: { "text/plain": { schema: { type: "string" } } } }, ...errors },
      },
    },
    "/objects": {
      get: {
        operationId: "getObjectByIri",
        summary: "One object by its IRI",
        tags: ["Objects"],
        parameters: [{ name: "iri", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": json({ type: "object" }), ...errors },
      },
    },
    "/actions": {
      get: { operationId: "listActionTypes", summary: "The active action types and their parameters", tags: ["Actions"], responses: { "200": json({ type: "array", items: { type: "object" } }), ...errors } },
    },
    "/submissions/{id}": {
      get: {
        operationId: "getSubmission",
        summary: "One action submission",
        tags: ["Actions"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": json(ref("Submission")), ...errors },
      },
    },
  };

  const listParams = [
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    { name: "cursor", in: "query", description: "nextCursor from the previous page", schema: { type: "string" } },
    { name: "q", in: "query", description: "Text in the label or IRI", schema: { type: "string" } },
    {
      name: "filter",
      in: "query",
      style: "deepObject",
      explode: true,
      description: "Equality on properties, e.g. filter[status]=active",
      schema: { type: "object", additionalProperties: { type: "string" } },
    },
  ];
  for (const t of model.objectTypes) {
    schemas[t.apiName] = objectTypeSchema(t);
    schemas[`${t.apiName}Page`] = {
      type: "object",
      required: ["data", "nextCursor"],
      properties: { data: { type: "array", items: ref(t.apiName) }, nextCursor: { type: ["string", "null"] } },
    };
    const base = `/objects/${t.prefix}/${t.localName}`;
    const tag = `${t.module.name}`;
    paths[base] = {
      get: { operationId: `list${t.apiName}`, summary: `${t.label} objects, subclasses included`, tags: [tag], parameters: listParams, responses: { "200": json(ref(`${t.apiName}Page`)), ...errors } },
    };
    paths[`${base}/{id}`] = {
      get: {
        operationId: `get${t.apiName}`,
        summary: `One ${t.label}: the object ${t.iri}/{id}`,
        tags: [tag],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": json(ref(t.apiName)), ...errors },
      },
    };
  }
  for (const a of model.actionTypes) {
    schemas[`${a.apiName}Params`] = actionParamsSchema(a);
    const body = { required: true, content: { "application/json": { schema: { type: "object", required: ["params"], properties: { params: ref(`${a.apiName}Params`) } } } } };
    const describe = `${a.description ?? a.displayName} Needs the ${a.minRole} role or higher and the actions scope.`;
    paths[`/actions/${a.key}/preview`] = {
      post: { operationId: `preview${a.apiName}`, summary: `Preview: ${a.displayName}`, description: describe, tags: ["Actions"], requestBody: body, responses: { "200": json(ref("Preview")), ...errors } },
    };
    paths[`/actions/${a.key}/submit`] = {
      post: { operationId: `submit${a.apiName}`, summary: `Submit: ${a.displayName}`, description: describe, tags: ["Actions"], requestBody: body, responses: { "200": json(ref("SubmitResult")), "409": json(ref("Error"), "The objects changed meanwhile; submit again"), ...errors } },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `Ontos Ontology API: ${model.workspace.name}`,
      version: "1",
      description:
        "Generated from this workspace's ontology. Reads return objects by type; writes go through action types, which check, record and audit every submission.",
      "x-ontology-version": model.version,
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: "Ontology" }, { name: "Objects" }, { name: "Actions" }, ...[...new Set(model.objectTypes.map((t) => t.module.name))].map((name) => ({ name }))],
    paths,
    components: {
      schemas,
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "An API token (ontos_…) from the Developers page" } },
    },
  };
}
