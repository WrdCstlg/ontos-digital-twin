import { useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { MODULES, getModule, moduleAlpha, type ModuleKey } from '@/lib/modules';
import { IRIChip } from '@/components/ui/iri-chip';
import { GraphCanvas, type GraphEdge, type GraphNode } from '@/components/graph/GraphCanvas';
import { cn } from '@/lib/utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface ModuleDetail {
  description: string;
  classes: string[];
  axioms: Array<[string, string, string]>; // from —rel→ to
}

const DETAILS: Record<Exclude<ModuleKey, 'custom'>, ModuleDetail> = {
  hr: {
    description: 'People, roles, org structure, skills, and compensation — the human backbone.',
    classes: ['hr:Person', 'hr:Role', 'hr:OrgUnit', 'hr:EmploymentContract', 'hr:Skill', 'hr:ReportingLine', 'hr:CompensationBand', 'hr:PerformanceReview'],
    axioms: [
      ['hr:Person', 'signs', 'legal:Contract'],
      ['hr:Person', 'memberOf', 'hr:OrgUnit'],
    ],
  },
  legal: {
    description: 'Contracts, clauses, obligations, and jurisdictions.',
    classes: ['legal:Contract', 'legal:Clause', 'legal:Party', 'legal:Obligation', 'legal:Jurisdiction', 'legal:Matter', 'legal:Regulation', 'legal:Precedent'],
    axioms: [
      ['legal:Contract', 'governedBy', 'cmp:Policy'],
      ['legal:Obligation', 'appliesTo', 'fin:Vendor'],
    ],
  },
  compliance: {
    description: 'Controls, policies, risks, and cross-framework mappings — SOX, GDPR, ISO 27001.',
    classes: ['cmp:Control', 'cmp:Policy', 'cmp:Regulation', 'cmp:Risk', 'cmp:AuditFinding', 'cmp:Evidence', 'cmp:Attestation', 'cmp:ControlMapping'],
    axioms: [
      ['cmp:Control', 'monitors', 'fin:Transaction'],
      ['hr:Person', 'signs', 'legal:Contract'],
    ],
  },
  finance: {
    description: 'Accounts, cost centers, transactions, budgets, vendors.',
    classes: ['fin:Account', 'fin:CostCenter', 'fin:Transaction', 'fin:Budget', 'fin:Invoice', 'fin:Vendor', 'fin:FiscalPeriod', 'fin:GLMapping'],
    axioms: [
      ['fin:Transaction', 'settledBy', 'log:Shipment'],
      ['cmp:Control', 'monitors', 'fin:Transaction'],
    ],
  },
  logistics: {
    description: 'Shipments, routes, warehouses, carriers, inventory.',
    classes: ['log:Shipment', 'log:Route', 'log:Warehouse', 'log:Carrier', 'log:InventoryItem', 'log:PurchaseOrder', 'log:DeliveryWindow', 'log:Incoterm'],
    axioms: [
      ['log:PurchaseOrder', 'billedTo', 'fin:Invoice'],
      ['log:Shipment', 'fulfills', 'legal:Obligation'],
    ],
  },
  twin: {
    description: 'Living digital twins of physical assets and facilities — DTDL-compatible models with telemetry, state, and topology.',
    classes: ['dtwin:DigitalTwin', 'dtwin:AssetTwin', 'dtwin:FacilityTwin', 'dtwin:WarehouseTwin', 'dtwin:ShipmentTwin', 'dtwin:ZoneTwin', 'dtwin:EquipmentTwin', 'dtwin:TwinModel'],
    axioms: [
      ['dtwin:WarehouseTwin', 'twinOf', 'log:Warehouse'],
      ['dtwin:SensorTwin', 'monitors', 'dtwin:ZoneTwin'],
    ],
  },
};


function miniGraph(key: Exclude<ModuleKey, 'custom'>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const classes = DETAILS[key].classes;
  const center: GraphNode = { id: `${key}-hub`, label: getModule(key).name, module: key, glyph: key.slice(0, 2), size: 40 };
  const nodes: GraphNode[] = [
    center,
    ...classes.map((c) => {
      const local = c.split(':')[1];
      return { id: c, label: local, module: key, glyph: local.slice(0, 2), size: 30 };
    }),
  ];
  const edges: GraphEdge[] = classes.map((c, i) => ({
    source: `${key}-hub`,
    target: c,
    label: i % 3 === 0 ? 'has' : undefined,
  }));
  // a couple of ring edges for texture
  for (let i = 0; i < classes.length; i += 2) {
    edges.push({ source: classes[i], target: classes[(i + 1) % classes.length] });
  }
  return { nodes, edges };
}

/** Animated flowing-dash axiom chip */
function AxiomChip({ from, rel, to, color }: { from: string; rel: string; to: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border-hairline bg-bg-inset px-2.5 py-1 font-mono text-[11px] text-text-secondary">
      <span className="text-text-primary">{from}</span>
      <svg width="34" height="8" aria-hidden>
        <line x1="0" y1="4" x2="34" y2="4" stroke={color} strokeWidth="1.5" strokeDasharray="5 4" className="axiom-flow" />
        <path d="M31 1.5 L35 4 L31 6.5" fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
      <span className="text-text-muted">{rel}</span>
      <span className="text-text-primary">{to}</span>
    </span>
  );
}

/** Section 4 — Module showcase: tab bar + split panel with mini class-graph. */
export function ModuleShowcase() {
  const [active, setActive] = useState<Exclude<ModuleKey, 'custom'>>('compliance');
  const mod = getModule(active);
  const detail = DETAILS[active];
  const graph = miniGraph(active);

  return (
    <section id="modules" className="mx-auto max-w-[1200px] scroll-mt-24 px-6 py-28">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">Module Library</p>
      <h2 className="mt-4 max-w-[680px] font-display text-[36px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[46px]">
        Five business functions, shipping today.
      </h2>

      {/* Tab bar */}
      <div className="mt-10 flex flex-wrap gap-2">
        {MODULES.map((m) => {
          const isActive = m.key === active;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setActive(m.key as Exclude<ModuleKey, 'custom'>)}
              className={cn(
                'rounded-full border px-4 py-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.08em] transition-all duration-200',
                !isActive && 'border-border-hairline text-text-secondary hover:border-border-glow hover:text-text-primary',
              )}
              style={
                isActive
                  ? { color: m.color, backgroundColor: moduleAlpha(m.color, 0.15), borderColor: moduleAlpha(m.color, 0.4) }
                  : undefined
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Split panel */}
      <div className="mt-6 overflow-hidden rounded-xl border border-border-hairline bg-bg-panel">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="grid lg:grid-cols-2"
          >
            {/* Left: detail */}
            <div className="p-7">
              <div className="flex items-start gap-5">
                <img src={mod.glyph} alt="" className="size-24 shrink-0 rounded-xl border border-border-hairline bg-bg-inset p-2" />
                <div>
                  <h3 className="font-display text-[22px] font-semibold" style={{ color: mod.color }}>
                    {mod.name}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-text-secondary">{detail.description}</p>
                  <p className="mt-2.5 font-mono text-[11px] text-text-muted">v2.3 · OWL 2 DL · SHACL-validated</p>
                  <Link
                    to={mod.route}
                    className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-text-accent transition-colors hover:text-iris-bright"
                  >
                    Open in Library <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>

              {/* Class chips */}
              <div className="mt-6 flex flex-wrap gap-2">
                {detail.classes.map((c, i) => (
                  <motion.span
                    key={c}
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.3, delay: 0.05 + i * 0.03, ease: EASE }}
                  >
                    <IRIChip iri={c} definition={`Class in the ${mod.name} ontology module.`} />
                  </motion.span>
                ))}
              </div>

              {/* Cross-module axioms */}
              <div className="mt-7 border-t border-border-hairline pt-5">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  Cross-module axioms
                </p>
                <div className="flex flex-wrap gap-2">
                  {detail.axioms.map(([f, r, t]) => (
                    <AxiomChip key={`${f}${r}${t}`} from={f} rel={r} to={t} color={mod.color} />
                  ))}
                </div>
              </div>
            </div>

            {/* Right: mini class-graph */}
            <div className="border-t border-border-hairline p-4 lg:border-l lg:border-t-0">
              <GraphCanvas
                key={active}
                nodes={graph.nodes}
                edges={graph.edges}
                controls={false}
                className="h-[380px]"
                onNodeClick={() => undefined}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <style>{`.axiom-flow { animation: axiomdash 1.5s linear infinite; } @keyframes axiomdash { to { stroke-dashoffset: -18; } }`}</style>
    </section>
  );
}

export default ModuleShowcase;
