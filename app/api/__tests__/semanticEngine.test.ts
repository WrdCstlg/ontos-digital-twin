import { describe, it, expect, beforeAll } from "vitest";
import {
  buildPrefixMap,
  datatypeRanges,
  modulePrefixes,
  moduleToTurtle,
  knowledgeGraphToTurtle,
  shaclJsonToTurtle,
} from "../services/rdfBridge";
import { EngineInterference, semanticEngine } from "../services/semanticEngine";
import { seedShaped } from "./rdfFixtures";
import type { OntologyClass, OntologyModule, OntologyProperty, KgNode, KgEdge } from "@db/schema";

describe("Semantic Engine & RDF Bridge Integration", () => {
  beforeAll(async () => {
    // Ensure the daemon is up for integration tests
    await semanticEngine.ensureEngineRunning();
  });

  describe("RDF Bridge Serialization", () => {
    it("serializes module schema into valid Turtle", () => {
      const mockModule: OntologyModule = {
        id: 1,
        workspaceId: 1,
        key: "hr",
        name: "Human Resources",
        prefix: "hr",
        color: "#10b981",
        version: "2.3",
        status: "active",
        description: "HR ontology module",
        documentation: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockClasses: OntologyClass[] = [
        {
          id: 1,
          moduleId: 1,
          iri: "hr:Person",
          label: "Person",
          parentId: null,
          definition: "An individual human being.",
          isCustom: false,
          deprecated: false,
          shaclJson: null,
          createdAt: new Date(),
        },
        {
          id: 2,
          moduleId: 1,
          iri: "hr:Employee",
          label: "Employee",
          parentId: 1,
          definition: "A person employed by the company.",
          isCustom: false,
          deprecated: false,
          shaclJson: null,
          createdAt: new Date(),
        },
      ];

      const mockProperties: OntologyProperty[] = [
        {
          id: 1,
          moduleId: 1,
          iri: "hr:fullName",
          label: "fullName",
          kind: "datatype",
          domainClassId: 1,
          rangeClassId: null,
          rangeDatatype: "xsd:string",
          cardinality: "1..1",
          definition: "Full legal name.",
          createdAt: new Date(),
        },
        {
          id: 2,
          moduleId: 1,
          iri: "hr:reportsTo",
          label: "reportsTo",
          kind: "object",
          domainClassId: 2,
          rangeClassId: 1,
          rangeDatatype: null,
          cardinality: "0..1",
          definition: "Manager relationship.",
          createdAt: new Date(),
        },
      ];

      const turtle = moduleToTurtle(mockModule, mockClasses, mockProperties);
      expect(turtle).toContain("@prefix hr: <https://ontos.dev/ontology/hr/> .");
      expect(turtle).toContain("hr:Person a owl:Class ;");
      expect(turtle).toContain("hr:Employee a owl:Class ;");
      expect(turtle).toContain("rdfs:subClassOf hr:Person");
      expect(turtle).toContain("hr:fullName a owl:DatatypeProperty ;");
      expect(turtle).toContain("hr:reportsTo a owl:ObjectProperty ;");
    });

    it("serializes knowledge graph nodes and edges to instance Turtle", () => {
      const mockNodes: KgNode[] = [
        {
          id: 101,
          workspaceId: 1,
          moduleKey: "hr",
          classIri: "hr:Person",
          iri: "hr:Person/E-0001",
          label: "Marcus Webb",
          propsJson: {
            fullName: "Marcus Webb",
            email: "marcus.webb@acme.com",
            salary: 150000.5,
            isCeo: true,
          },
          sourceMappingId: null,
          sourceSubmissionId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 102,
          workspaceId: 1,
          moduleKey: "hr",
          classIri: "hr:Person",
          iri: "hr:Person/E-0002",
          label: "Jane Doe",
          propsJson: {
            fullName: "Jane Doe",
            email: "jane.doe@acme.com",
            hireDate: "2024-01-15",
          },
          sourceMappingId: null,
          sourceSubmissionId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];

      const mockEdges: KgEdge[] = [
        {
          id: 1,
          workspaceId: 1,
          moduleKey: "hr",
          fromNodeId: 102,
          toNodeId: 101,
          predicateIri: "hr:reportsTo",
          sourceMappingId: null,
          sourceSubmissionId: null,
          createdAt: new Date(),
          deletedAt: null,
        },
      ];

      const turtle = knowledgeGraphToTurtle(mockNodes, mockEdges);
      expect(turtle).toContain("<https://ontos.dev/ontology/hr/Person/E-0001> a hr:Person ;");
      expect(turtle).toContain('rdfs:label "Marcus Webb"');
      expect(turtle).toContain('hr:salary "150000.5"^^xsd:decimal');
      expect(turtle).toContain('hr:isCeo "true"^^xsd:boolean');
      expect(turtle).toContain('hr:hireDate "2024-01-15"^^xsd:date');
      expect(turtle).toContain("hr:reportsTo <https://ontos.dev/ontology/hr/Person/E-0001>");
    });

    it("types each value as its property declares, when the value fits, as an import's strings must be", () => {
      const imported: KgNode = {
        id: 1, workspaceId: 1, moduleKey: "fin", classIri: "fin:Transaction", iri: "fin:txn/1", label: "TXN-1",
        // An import stores every value as the source gave it: a string.
        propsJson: {
          "fin:amount": " 1234.56 ", "fin:units": "12", "fin:settled": "true", "fin:bookedOn": "2026-01-15",
          "fin:postedAt": "2026-01-15T09:30:00Z", "fin:reference": "2026-01-15", "fin:rate": "1.5e-3",
          "fin:count": "twelve", "fin:flag": "TRUE", "fin:note": "free text",
        },
        sourceMappingId: 1, sourceSubmissionId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      };
      const ranges = datatypeRanges([
        { iri: "fin:amount", kind: "datatype", rangeDatatype: "xsd:decimal" },
        { iri: "fin:units", kind: "datatype", rangeDatatype: "integer" },
        { iri: "fin:settled", kind: "datatype", rangeDatatype: "xsd:boolean" },
        { iri: "fin:bookedOn", kind: "datatype", rangeDatatype: "xsd:date" },
        { iri: "fin:postedAt", kind: "datatype", rangeDatatype: "xsd:dateTime" },
        { iri: "fin:reference", kind: "datatype", rangeDatatype: "xsd:string" },
        { iri: "fin:rate", kind: "datatype", rangeDatatype: "xsd:double" },
        { iri: "fin:count", kind: "datatype", rangeDatatype: "xsd:integer" },
        { iri: "fin:flag", kind: "datatype", rangeDatatype: "xsd:boolean" },
        { iri: "fin:bookedTo", kind: "object", rangeDatatype: null },
      ]);
      expect(ranges.get("fin:units")).toBe("xsd:integer");
      expect(ranges.has("fin:bookedTo")).toBe(false);

      const turtle = knowledgeGraphToTurtle([imported], [], undefined, ranges);
      expect(turtle).toContain('fin:amount "1234.56"^^xsd:decimal');
      expect(turtle).toContain('fin:units "12"^^xsd:integer');
      expect(turtle).toContain('fin:settled "true"^^xsd:boolean');
      expect(turtle).toContain('fin:bookedOn "2026-01-15"^^xsd:date');
      expect(turtle).toContain('fin:postedAt "2026-01-15T09:30:00Z"^^xsd:dateTime');
      expect(turtle).toContain('fin:reference "2026-01-15"^^xsd:string');
      expect(turtle).toContain('fin:rate "1.5e-3"^^xsd:double');
      // A value that does not fit its declared type keeps its own, so SHACL still reports it.
      expect(turtle).toContain('fin:count "twelve"^^xsd:string');
      expect(turtle).toContain('fin:flag "TRUE"^^xsd:string');
      // Without a declared range, a value is typed from its shape, as before.
      expect(turtle).toContain('fin:note "free text"^^xsd:string');
      expect(knowledgeGraphToTurtle([imported], [])).toContain('fin:amount " 1234.56 "^^xsd:string');
    });

    it("compiles shaclJson declarations into W3C SHACL Turtle shapes", () => {
      const mockClasses: OntologyClass[] = [
        {
          id: 1,
          moduleId: 1,
          iri: "hr:Person",
          label: "Person",
          parentId: null,
          definition: null,
          isCustom: false,
          deprecated: false,
          shaclJson: {
            shape: "hr:PersonShape",
            constraints: [
              {
                path: "hr:fullName",
                minCount: 1,
                maxCount: 1,
                datatype: "xsd:string",
                severity: "Violation",
              },
              {
                path: "hr:email",
                minCount: 1,
                pattern: "^[^@]+@acme\\.com$",
                severity: "Violation",
              },
            ],
          },
          createdAt: new Date(),
        },
      ];

      const shapesTurtle = shaclJsonToTurtle(mockClasses);
      expect(shapesTurtle).toContain("hr:PersonShape a sh:NodeShape ;");
      expect(shapesTurtle).toContain("sh:targetClass hr:Person ;");
      expect(shapesTurtle).toContain("sh:path hr:fullName ;");
      expect(shapesTurtle).toContain("sh:minCount 1 ;");
      expect(shapesTurtle).toContain("sh:datatype xsd:string ;");
      expect(shapesTurtle).toContain('sh:pattern "^[^@]+@acme\\\\.com$"');
      expect(shapesTurtle).toContain("sh:severity sh:Violation");
    });
  });

  describe("open-ontologies Engine Live Operations", () => {
    it("connects to open-ontologies /health probe", async () => {
      const health = await semanticEngine.checkHealth();
      expect(health.alive).toBe(true);
      expect(health.version).toBeDefined();
      expect(health.url).toBe(semanticEngine.getUrl());
    });

    it("loads a workspace graph whose module keys differ from their prefixes, every triple of it", async () => {
      // Before the renderer declared every prefix it wrote, the engine refused this whole graph.
      await semanticEngine.clearStore();
      const { modules, nodes, edges, triples } = seedShaped;
      const turtle = knowledgeGraphToTurtle(nodes, edges, buildPrefixMap(modules), undefined, modulePrefixes(modules));

      expect((await semanticEngine.loadTurtle(turtle)).triplesLoaded).toBe(triples);
      const amount = await semanticEngine.querySparql(
        "SELECT ?v WHERE { <https://ontos.dev/ontology/fin/Invoice/INV-1> <https://ontos.dev/ontology/fin/amount> ?v }",
      );
      expect(amount.results).toHaveLength(1);
    });

    it("checks what a task loaded, and refuses a check whose store another writer changed", async () => {
      const { modules, nodes, edges, triples } = seedShaped;
      const turtle = knowledgeGraphToTurtle(nodes, edges, buildPrefixMap(modules), undefined, modulePrefixes(modules));
      const load = async () => (await semanticEngine.loadTurtle(turtle)).triplesLoaded;
      // Undisturbed: the store holds exactly what was loaded, before and after.
      await expect(semanticEngine.exclusive(() => semanticEngine.checkLoaded(load, () => semanticEngine.countTriples()))).resolves.toBe(triples);
      // Another writer while the check runs, as a request an earlier task gave up on would be.
      const intruder = () =>
        fetch(`${semanticEngine.getUrl()}/api/update`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "INSERT DATA { <urn:intruder> <urn:p> <urn:o> }" }),
        }).then(() => "a report on the wrong data");
      await expect(semanticEngine.exclusive(() => semanticEngine.checkLoaded(load, intruder))).rejects.toBeInstanceOf(EngineInterference);
    });

    it("loads Turtle and runs SPARQL SELECT query", async () => {
      await semanticEngine.clearStore();

      const turtle = `
        @prefix ex: <https://ontos.dev/test/> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        
        ex:Mammal rdfs:subClassOf ex:Animal .
        ex:Cat rdfs:subClassOf ex:Mammal .
        ex:Whiskers a ex:Cat ;
          rdfs:label "Whiskers" .
      `;

      const loadRes = await semanticEngine.loadTurtle(turtle);
      expect(loadRes.ok).toBe(true);
      expect(loadRes.triplesLoaded).toBeGreaterThanOrEqual(3);

      const queryRes = await semanticEngine.querySparql(`
        PREFIX ex: <https://ontos.dev/test/>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?label WHERE {
          ex:Whiskers rdfs:label ?label .
        }
      `);

      expect(queryRes.variables).toContain("label");
      expect(queryRes.results.length).toBe(1);
      expect(queryRes.results[0].label).toContain("Whiskers");
    });

    it("executes native OWL-RL reasoning and materializes inferred triples", async () => {
      await semanticEngine.clearStore();

      const turtle = `
        @prefix ex: <https://ontos.dev/test/> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .

        ex:Animal a owl:Class .
        ex:Mammal a owl:Class ;
          rdfs:subClassOf ex:Animal .
        ex:Dog a owl:Class ;
          rdfs:subClassOf ex:Mammal .
        
        ex:Fido a ex:Dog .
      `;

      await semanticEngine.loadTurtle(turtle);
      const reasoning = await semanticEngine.runReasoning("owl-rl");

      expect(reasoning.ok).toBe(true);
      expect(reasoning.profile).toBe("owl-rl");
      expect(reasoning.inferredCount).toBeGreaterThanOrEqual(1);

      const askRes = await semanticEngine.querySparql(`
        PREFIX ex: <https://ontos.dev/test/>
        SELECT ?type WHERE {
          ex:Fido a ?type .
        }
      `);

      const types = askRes.results.map((r) => r.type);
      expect(types.some((t) => t.includes("Animal"))).toBe(true);
      expect(types.some((t) => t.includes("Mammal"))).toBe(true);
      expect(types.some((t) => t.includes("Dog"))).toBe(true);
    });

    it("validates data with W3C SHACL shapes (detecting conformance and violations)", async () => {
      await semanticEngine.clearStore();

      const shapesTtl = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        @prefix hr: <https://ontos.dev/ontology/hr/> .

        hr:PersonShape a sh:NodeShape ;
          sh:targetClass hr:Person ;
          sh:property [
            sh:path hr:email ;
            sh:minCount 1 ;
            sh:pattern "^[^@]+@acme\\\\.com$" ;
            sh:severity sh:Violation ;
          ] .
      `;

      // 1. Valid data
      const validData = `
        @prefix hr: <https://ontos.dev/ontology/hr/> .
        <https://ontos.dev/ontology/hr/Person/1> a hr:Person ;
          hr:email "alice@acme.com" .
      `;

      await semanticEngine.loadTurtle(validData);
      const passReport = await semanticEngine.validateShacl(shapesTtl);
      expect(passReport.conforms).toBe(true);
      expect(passReport.violationCount).toBe(0);

      // 2. Non-conforming data (invalid email domain)
      await semanticEngine.clearStore();
      const invalidData = `
        @prefix hr: <https://ontos.dev/ontology/hr/> .
        <https://ontos.dev/ontology/hr/Person/2> a hr:Person ;
          hr:email "bob@external-hacker.org" .
      `;

      await semanticEngine.loadTurtle(invalidData);
      const failReport = await semanticEngine.validateShacl(shapesTtl);
      expect(failReport.conforms).toBe(false);
      expect(failReport.violationCount).toBe(1);
      expect(failReport.violations[0].constraint).toBe("pattern");
      expect(failReport.violations[0].focusNode).toContain("Person/2");
    });

    it("keeps concurrent clear → load → query sequences from seeing each other's data", async () => {
      // Each run loads its own graph and counts what it can see. Without the
      // lock, one run's clear lands between the other's load and query.
      const run = (tag: string, size: number) =>
        semanticEngine.exclusive(async () => {
          await semanticEngine.clearStore();
          const triples = Array.from(
            { length: size },
            (_, i) => `<https://ontos.dev/test/${tag}/${i}> a <https://ontos.dev/test/${tag}> .`,
          ).join("\n");
          await semanticEngine.loadTurtle(triples);
          // Yield so the other run gets every chance to interleave.
          await new Promise((r) => setTimeout(r, 20));
          const res = await semanticEngine.querySparql(
            "SELECT (COUNT(*) AS ?n) WHERE { ?s a ?type }",
          );
          return Number(String(res.results[0]?.n ?? "0").replace(/^"|"(\^\^.*)?$/g, ""));
        });

      const counts = await Promise.all([run("alpha", 3), run("beta", 5), run("alpha", 3), run("beta", 5)]);
      expect(counts).toEqual([3, 5, 3, 5]);
    });
  });
});
