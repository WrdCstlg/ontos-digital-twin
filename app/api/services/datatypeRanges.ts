import { eq, inArray } from "drizzle-orm";
import { ontologyModules, ontologyProperties } from "@db/schema";
import { getDb } from "../queries/connection";
import { datatypeRanges } from "./rdfBridge";

/**
 * The declared range of each of a workspace's datatype properties, by IRI, so
 * that what is sent to the engine types each value as the ontology says
 * (rdfBridge.knowledgeGraphToTurtle).
 */
export async function workspaceDatatypeRanges(workspaceId: number): Promise<Map<string, string>> {
  const db = getDb();
  const mods = await db.select({ id: ontologyModules.id }).from(ontologyModules).where(eq(ontologyModules.workspaceId, workspaceId));
  if (mods.length === 0) return new Map();
  const props = await db
    .select({ iri: ontologyProperties.iri, kind: ontologyProperties.kind, rangeDatatype: ontologyProperties.rangeDatatype })
    .from(ontologyProperties)
    .where(inArray(ontologyProperties.moduleId, mods.map((m) => m.id)));
  return datatypeRanges(props);
}
