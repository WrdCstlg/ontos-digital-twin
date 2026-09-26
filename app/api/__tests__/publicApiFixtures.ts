import type { OntologyModel } from "../services/publicApi/model";
import type { ApiObject } from "../services/publicApi/objects";

/** A small ontology: a person type with a subclass, a contract, and two action types. */
export const fixtureModel: OntologyModel = {
  workspace: { id: 1, name: "Acme Corp — Production", slug: "acme-corp-production" },
  version: "a1b2c3d4e5f6",
  modules: [
    { key: "hr", name: "HR", prefix: "hr", version: "2.3", status: "published" },
    { key: "legal", name: "Legal", prefix: "lgl", version: "1.0", status: "published" },
  ],
  objectTypes: [
    {
      iri: "hr:Person",
      apiName: "HrPerson",
      prefix: "hr",
      localName: "Person",
      module: { key: "hr", name: "HR", prefix: "hr" },
      label: "Person",
      description: "Someone who works here. */ console.log('escaped') /*",
      parent: null,
      deprecated: false,
      properties: [
        { iri: "hr:fullName", key: "fullName", label: "Full name", type: "string", required: true, multiple: false, description: null },
        { iri: "hr:salary", key: "salary", label: "Salary", type: "number", required: false, multiple: false, description: null },
        { iri: "hr:start-date", key: "start-date", label: "Start date", type: "date", required: false, multiple: false, description: null },
        { iri: "hr:skill", key: "skill", label: "Skill", type: "string", required: false, multiple: true, description: null },
      ],
      links: [{ iri: "hr:reportsTo", key: "reportsTo", label: "Reports to", target: "hr:Person", required: false, multiple: false, description: null }],
    },
    {
      iri: "hr:Employee",
      apiName: "HrEmployee",
      prefix: "hr",
      localName: "Employee",
      module: { key: "hr", name: "HR", prefix: "hr" },
      label: "Employee",
      description: null,
      parent: "hr:Person",
      deprecated: false,
      properties: [{ iri: "hr:fullName", key: "fullName", label: "Full name", type: "string", required: true, multiple: false, description: null }],
      links: [],
    },
    {
      iri: "lgl:Contract",
      apiName: "LglContract",
      prefix: "lgl",
      localName: "Contract",
      module: { key: "legal", name: "Legal", prefix: "lgl" },
      label: "Contract",
      description: null,
      parent: null,
      deprecated: true,
      properties: [{ iri: "lgl:endDate", key: "endDate", label: "End date", type: "date", required: false, multiple: false, description: null }],
      links: [],
    },
  ],
  actionTypes: [
    {
      key: "renew-contract",
      apiName: "RenewContract",
      displayName: "Renew contract",
      description: "Extends a contract.",
      module: "legal",
      minRole: "editor",
      version: 3,
      parameters: [
        { name: "contract", label: "Contract", type: "object", classIri: "lgl:Contract", required: true },
        { name: "newEndDate", label: "New end date", type: "date", required: true },
        { name: "reason", label: "Reason", type: "enum", options: ["renewal", "extension"], required: false },
      ],
    },
    {
      key: "record-termination",
      apiName: "RecordTermination",
      displayName: "Record termination",
      description: null,
      module: "hr",
      minRole: "ontologist",
      version: 1,
      parameters: [{ name: "employee", label: "Employee", type: "object", classIri: "hr:Person", required: true }],
    },
  ],
} as OntologyModel;

export function fixtureObject(iri: string, objectType = "hr:Person", props: Record<string, unknown> = { fullName: "Ada Byron" }): ApiObject {
  return {
    iri,
    objectType,
    label: String(props.fullName ?? iri),
    properties: props,
    links: {},
    source: { mappingId: 1, submissionId: null },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}
