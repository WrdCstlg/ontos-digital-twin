import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BookCopy,
  Compass,
  DatabaseZap,
  LayoutDashboard,
  MapIcon,
  ScanHeart,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Waypoints,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ── content: sourced from a live walkthrough of the running app,
   snapshot v48 on the Acme Corp demo build — no placeholder numbers ── */

const VALUE_PROPS = [
  {
    n: '01',
    title: 'Cross-system risk, found for you',
    body: 'Twelve standing rules re-check the whole graph on every sync — spend concentration, budget overruns, unmitigated risk, expiring contracts, cold-chain breaches, and more. Each one only fires on a contradiction that spans two or more source systems — the class of problem no single team’s dashboard was ever built to catch.',
  },
  {
    n: '02',
    title: 'Ask in English, get evidence back',
    body: 'Type a question across all five domains at once. Every answer traces back to the exact nodes and edges that produced it — a subgraph you can click through, not a confident-sounding guess.',
  },
  {
    n: '03',
    title: 'One definition, everywhere',
    body: 'HR’s “Employee,” Legal’s “Party,” and Finance’s “Vendor” get reconciled into one versioned, validated model. Change it once, and every downstream mapping inherits the update.',
  },
];

const ROLE_CARDS = [
  {
    color: '#34D399',
    name: 'Alex Morgan',
    title: 'Compliance Analyst',
    chip: 'Viewer',
    question: '“Is anything I’m accountable for exposed right now?”',
    sees:
      'Insights flags 1 contract governed by a policy with an open audit finding — ACME-CTR-0042, under the Data Protection Policy, against open finding AF-2025-014.',
    decision:
      'Traces the evidence, confirms the finding is still open, and holds the renewal — instead of finding out during the external audit.',
  },
  {
    color: '#FBBF24',
    name: 'Whoever owns vendor spend',
    title: 'Finance / AP',
    chip: 'Viewer',
    question: '“Are we paying anyone we shouldn’t be, or losing track of spend?”',
    sees:
      '5 vendors received payments but have no active contract (Castillo Logistics, Jimenez Logistics, Park Supply Co, Beaumont Consulting, Sørensen Supply Co), 9 transactions with no cost center — $178,405 unallocated — and one vendor alone accounts for 24% of total vendor spend.',
    decision:
      'Freezes payment runs to the five unsigned vendors, forces the $178K into a cost center before the books close, and opens a second-source review for the concentrated vendor.',
  },
  {
    color: '#A78BFA',
    name: 'Dr. James Wei',
    title: 'Ontology Engineer',
    chip: 'Ontologist',
    question: '“Does ‘Contract’ mean the same thing in Legal and Finance yet?”',
    sees: 'The Module Library — HR v2.3, Legal v1.8, Compliance v3.1, Finance v2.0 — each versioned, each with SHACL shapes attached.',
    decision:
      'Edits the class in Ontology Studio, runs the reasoner, validates, and publishes v1.9 — every downstream mapping now targets the same definition.',
  },
  {
    color: '#818CF8',
    name: 'Elena Cortez',
    title: 'Chief Data Officer',
    chip: 'Admin',
    question: '“Who has access to what, and can I prove it if asked?”',
    sees: 'Workspace roles, connected LLM providers, and a hash-chained audit log covering every change made in the graph.',
    decision: 'Exports the audit log ahead of the next SOC 2 review — no reconstruction from memory or Slack threads.',
  },
];

const SCREENS = [
  {
    icon: LayoutDashboard,
    color: '#818CF8',
    title: 'Dashboard',
    path: '/app',
    body: 'Where every session starts. Four headline numbers, the live graph rendered as a mini-map, a module health strip, and a ranked “Needs Attention” list — the same insights from the Insights page, surfaced before you go looking.',
  },
  {
    icon: Waypoints,
    color: '#38BDF8',
    title: 'Graph Explorer',
    path: '/app/explorer',
    body: 'Ask a question in plain English; get back a table, a chart, or a subgraph. It isn’t a chatbot guessing — questions are matched against roughly a dozen ontology-grounded shapes, so every answer is traceable to real nodes and edges.',
  },
  {
    icon: Sparkles,
    color: '#FBBF24',
    title: 'Insights',
    path: '/app/insights',
    body: 'The standing rule engine, in full. Twelve rules — each spanning two or more source systems — re-run on every sync. Every hit carries an evidence trail, and can be acknowledged or turned into a watch rule that re-alerts if it recurs.',
  },
  {
    icon: BookCopy,
    color: '#A78BFA',
    title: 'Module Library & Ontology Studio',
    path: '/app/library',
    body: 'The shared vocabulary itself, versioned like code. The Library shows what’s published; the Studio is where an ontologist edits a class, runs the reasoner, validates against SHACL shapes, and publishes a new version.',
  },
  {
    icon: DatabaseZap,
    color: '#34D399',
    title: 'Mapping & Sync',
    path: '/app/mapping',
    body: 'Where the graph’s data actually comes from. Real connectors — a CSV export, a Postgres contracts DB, a REST ERP feed — each field-mapped into an ontology class, synced on a schedule or live via CDC, every run diffed against the last snapshot. “Run sync” queues the import; a background worker runs it and the run’s row updates when it finishes.',
  },
  {
    icon: ServerCog,
    color: '#38BDF8',
    title: 'Operations',
    path: '/app/operations',
    body: 'The job queue behind every import. How many jobs are queued, running, done or failed, how long the oldest has waited, and whether a worker is alive to run them — with each job’s attempts, lease and last error. A job gets up to three attempts, with a backoff between them; admins can retry a failed job or cancel one that hasn’t started.',
  },
  {
    icon: Zap,
    color: '#818CF8',
    title: 'Actions',
    path: '/app/actions',
    body: 'Governed edits to the graph. An action type such as “Reassign manager” or “Renew contract” names its parameters, the criteria a submission must meet, and exactly what it changes; some also check the result against the class’s SHACL shapes. Preview shows every check and every before → after without writing anything. Submit either applies it in one transaction or records why it was refused, and each object it touches remembers the submission. Start one from an object’s drawer in the Graph Explorer or from a finding in Insights; ontologists and admins define new ones, and every saved change is a new version.',
  },
  {
    icon: ScanHeart,
    color: '#2DD4BF',
    title: 'Twin Explorer',
    path: '/app/twins',
    body: 'Simulated live telemetry for the physical side — shipments, facilities, logistics assets — modeled as DTDL-compatible digital twins inside the same graph, so a delayed shipment and the carrier contract that governs it live in one connected model.',
  },
  {
    icon: ShieldCheck,
    color: '#F87171',
    title: 'Admin',
    path: '/app/admin',
    body: 'Tenancy, roles, connected LLM providers, and the append-only audit log — the tab you open when someone asks “who changed this contract’s status, and when,” and you need an answer that isn’t a guess.',
  },
  {
    icon: MapIcon,
    color: '#A5B4FC',
    title: 'Landscape',
    path: '/app/landscape',
    body: 'Where Ontos stands next to Palantir Foundry’s Ontology, area by area and with an honest status for each, plus the architecture as it runs today and the increments that change it next. The page to open when someone asks “how does this compare?”.',
  },
];

const TIMELINE = [
  { clock: '8:41 am', text: 'Logs in, lands on the Dashboard. Needs Attention shows three cards; one is tagged Risk.' },
  {
    clock: '8:43 am',
    text: 'Opens it: 1 contract governed by a policy with open audit findings.',
    evidence: 'ACME-CTR-0042 ← Data Protection Policy (POL-07) ← open finding AF-2025-014',
  },
  { clock: '8:45 am', text: 'Clicks Trace evidence — lands in Graph Explorer with the exact subgraph pre-loaded, no manual query.' },
  {
    clock: '8:48 am',
    text: 'Types a follow-up — “which employees signed contracts governed by policies with open audit findings” — checking whether this is isolated or a pattern.',
  },
  {
    clock: '8:51 am',
    text: 'One contract, one signer. Not a pattern. Sets a watch rule to be re-notified if it recurs, then messages Legal directly with the finding ID.',
  },
  { clock: '8:53 am', text: 'Done. Twelve minutes — no spreadsheet reconciliation, no email chain asking three teams to each check their own system.' },
];

const ROLE_TABLE = [
  { role: 'Viewer', view: 'Dashboard, Insights, Graph Explorer', change: 'Nothing — read-only', who: 'Alex Morgan, Compliance Analyst' },
  { role: 'Editor', view: '+ Mapping & Sync, connector status', change: 'Field mappings, sync jobs, actions open to editors — not the model itself', who: 'Priya Sharma, Data Steward' },
  { role: 'Ontologist', view: '+ Ontology Studio', change: 'Classes, properties, SHACL shapes, module versions, action types', who: 'Dr. James Wei, Ontology Engineer' },
  { role: 'Admin', view: 'Everything', change: 'Workspaces, member roles, LLM providers, audit export', who: 'Elena Cortez, Chief Data Officer' },
];

const TOC = [
  { id: 'why', label: 'Why it exists' },
  { id: 'who', label: 'Who opens it' },
  { id: 'app', label: 'Walking through it' },
  { id: 'monday', label: 'A Monday morning' },
  { id: 'roles', label: 'Roles & access' },
];

/** Sticky in-page scroll-spy TOC, mirrors the pattern used on Decisions & Architecture. */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function GuideTocRail({ activeId }: { activeId: string | null }) {
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <motion.nav
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.25, ease: EASE }}
      aria-label="On this page"
      className="sticky top-20 hidden w-[200px] shrink-0 self-start lg:block"
    >
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">On this page</p>
      <ul className="space-y-0.5 border-l border-border-hairline -ml-px pl-0">
        {TOC.map((t) => {
          const active = activeId === t.id;
          return (
            <li key={t.id} className="relative">
              {active && (
                <motion.span
                  layoutId="guide-toc-indicator"
                  transition={{ duration: 0.2, ease: EASE }}
                  className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-iris"
                  aria-hidden
                />
              )}
              <a
                href={`#${t.id}`}
                onClick={jump(t.id)}
                className={cn(
                  'block truncate py-1 pl-3 font-mono text-[11.5px] transition-colors duration-150',
                  active ? 'text-text-accent' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {t.label}
              </a>
            </li>
          );
        })}
      </ul>
    </motion.nav>
  );
}

function ValueCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border-hairline bg-bg-panel p-5">
      <span className="font-mono text-[11px] text-text-accent">{n}</span>
      <h3 className="mt-2 font-display text-[15px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.6] text-text-secondary">{body}</p>
    </div>
  );
}

function RoleCard(role: (typeof ROLE_CARDS)[number]) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border-hairline bg-bg-panel p-5"
      style={{ boxShadow: `inset 0 2px 0 0 ${role.color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-medium text-text-primary">{role.name}</div>
          <div className="text-[11.5px] text-text-muted">{role.title}</div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
          style={{ color: role.color, backgroundColor: `${role.color}26`, border: `1px solid ${role.color}40` }}
        >
          {role.chip}
        </span>
      </div>
      <dl className="space-y-2.5">
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">Opens it to answer</dt>
          <dd className="mt-0.5 text-[13.5px] italic leading-[1.55] text-text-secondary">{role.question}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">Sees</dt>
          <dd className="mt-0.5 text-[13.5px] leading-[1.55] text-text-primary">{role.sees}</dd>
        </div>
        <div>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted">Decision</dt>
          <dd className="mt-0.5 text-[13.5px] leading-[1.55] text-text-primary">{role.decision}</dd>
        </div>
      </dl>
    </div>
  );
}

function ScreenRow(screen: (typeof SCREENS)[number]) {
  const Icon = screen.icon;
  return (
    <div className="flex flex-col gap-2 border-t border-border-hairline py-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 font-display text-[16.5px] font-semibold text-text-primary">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${screen.color}22`, color: screen.color }}
          >
            <Icon className="size-4" />
          </span>
          {screen.title}
        </h3>
        <Link
          to={screen.path}
          className="flex items-center gap-1 font-mono text-[11px] text-text-muted transition-colors hover:text-text-accent"
        >
          {screen.path}
          <ArrowRight className="size-3" />
        </Link>
      </div>
      <p className="max-w-[640px] text-[13.75px] leading-[1.65] text-text-secondary">{screen.body}</p>
    </div>
  );
}

/**
 * Field Guide — /app/guide. What Ontos is for, who opens it and why, a
 * page-by-page walkthrough, and a real end-to-end decision scenario.
 * Content sourced from a live walkthrough of the running app (snapshot v48).
 */
export default function Guide() {
  const activeId = useScrollSpy(TOC.map((t) => t.id));

  return (
    <div className="mx-auto max-w-[1180px]">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="max-w-[820px]"
      >
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">
          <Compass className="size-3.5" />
          Field Guide
        </p>
        <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
          Five systems, one graph, and the questions it exists to catch before they get expensive.
        </h1>
        <p className="mt-3 max-w-[680px] text-[15px] leading-[1.6] text-text-secondary">
          Ontos connects HR, Legal, Compliance, Finance, and Logistics records into a single knowledge graph, then
          continuously checks it for the contradictions between those systems that create risk — automatically,
          with evidence attached.
        </p>
        <p className="mt-4 font-mono text-[12px] text-text-muted">
          4 roles · 12 standing rules · snapshot v48 · Acme Corp demo
        </p>
      </motion.header>

      <div className="mt-10 flex items-start gap-10">
        <GuideTocRail activeId={activeId} />

        <div className="min-w-0 flex-1 max-w-[820px] space-y-16">
          <section id="why">
            <h2 className="font-display text-[22px] font-semibold text-text-primary">What problem this actually solves</h2>
            <p className="mt-1.5 max-w-[640px] text-[13.5px] text-text-muted">
              If the value isn’t obvious from the dashboard alone, that’s a fair reaction — a screen of green
              checkmarks doesn’t explain itself.
            </p>
            <p className="mt-4 max-w-[640px] text-[14.5px] leading-[1.7] text-text-secondary">
              Your HRIS knows who reports to whom. Your contracts database knows what’s been signed. Your ERP
              knows what’s been paid. Each system is confidently correct about its own slice — and none of the
              three has ever compared notes with the other two. That gap is exactly where the expensive surprises
              live: a vendor still getting paid with no signed contract on file, a contract sitting under a policy
              with an audit finding nobody closed out, $178K in transactions with no cost center to charge them to. No
              single source system can see any of that, because seeing it requires reading two or three systems as
              one. Ontos is that one system.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {VALUE_PROPS.map((v) => (
                <ValueCard key={v.n} {...v} />
              ))}
            </div>
          </section>

          <section id="who">
            <h2 className="font-display text-[22px] font-semibold text-text-primary">Who opens it, and for what decision</h2>
            <p className="mt-1.5 max-w-[640px] text-[13.5px] text-text-muted">
              Put four different jobs in front of it, and each one is solving a different five-minute problem.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {ROLE_CARDS.map((r) => (
                <RoleCard key={r.name} {...r} />
              ))}
            </div>
          </section>

          <section id="app">
            <h2 className="font-display text-[22px] font-semibold text-text-primary">Walking through the app</h2>
            <p className="mt-1.5 max-w-[640px] text-[13.5px] text-text-muted">
              Same sidebar for everyone — what each role does inside it is what changes.
            </p>
            <div className="mt-2">
              {SCREENS.map((s) => (
                <ScreenRow key={s.title} {...s} />
              ))}
            </div>
          </section>

          <section id="monday">
            <h2 className="font-display text-[22px] font-semibold text-text-primary">A Monday morning, start to finish</h2>
            <p className="mt-1.5 max-w-[640px] text-[13.5px] text-text-muted">
              What “decision support” actually looks like, in one real session as the Compliance Analyst.
            </p>
            <div className="mt-6 flex flex-col">
              {TIMELINE.map((beat, i) => (
                <div key={beat.clock} className="relative grid grid-cols-[30px_1fr] gap-4 pb-6 last:pb-0">
                  {i < TIMELINE.length - 1 && (
                    <span className="absolute left-[14px] top-8 bottom-0 w-px bg-border-hairline" aria-hidden />
                  )}
                  <span className="z-10 flex size-[30px] items-center justify-center rounded-full border border-border-hairline bg-bg-panel font-mono text-[12px] text-text-accent">
                    {i + 1}
                  </span>
                  <div className="pt-1">
                    <div className="font-mono text-[11px] text-text-muted">{beat.clock}</div>
                    <p className="mt-0.5 text-[14px] leading-[1.6] text-text-primary">{beat.text}</p>
                    {beat.evidence && (
                      <div className="mt-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2 font-mono text-[11.5px] text-text-secondary">
                        {beat.evidence}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="roles">
            <h2 className="font-display text-[22px] font-semibold text-text-primary">Roles &amp; what they unlock</h2>
            <p className="mt-1.5 max-w-[640px] text-[13.5px] text-text-muted">
              Same four roles from above, laid out as permissions.
            </p>
            <div className="mt-6 overflow-hidden rounded-xl border border-border-hairline bg-bg-panel">
              <Table>
                <TableHeader>
                  <TableRow className="border-border-hairline hover:bg-transparent">
                    <TableHead className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-muted">Role</TableHead>
                    <TableHead className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-muted">Can view</TableHead>
                    <TableHead className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-muted">Can change</TableHead>
                    <TableHead className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-text-muted">Real example</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ROLE_TABLE.map((r) => (
                    <TableRow key={r.role} className="border-border-hairline hover:bg-bg-panel-raised/50">
                      <TableCell className="whitespace-nowrap text-[13.5px] font-medium text-text-primary">{r.role}</TableCell>
                      <TableCell className="text-[13px] text-text-secondary">{r.view}</TableCell>
                      <TableCell className="text-[13px] text-text-secondary">{r.change}</TableCell>
                      <TableCell className="text-[12.5px] text-text-muted">{r.who}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <footer className="border-t border-border-hairline pt-6">
            <p className="max-w-[640px] text-[12.5px] leading-[1.6] text-text-muted">
              Written against workspace snapshot v48 on the Acme Corp demo build. Point it at real HRIS, contracts,
              and ERP sources and the same twelve rules run on your own data.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
