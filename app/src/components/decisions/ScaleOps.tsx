import { motion } from 'framer-motion';
import { DatabaseBackup, Rocket, Scale } from 'lucide-react';
import { CopyButton } from './CopyButton';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function Snippet({ code }: { code: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2">
      <code className="truncate font-mono text-[11.5px] text-text-secondary">{code}</code>
      <CopyButton text={code} />
    </div>
  );
}

const PANELS = [
  {
    icon: Scale,
    title: 'Horizontal scaling',
    body: 'Stateless Hono/tRPC API replicas behind the load balancer; sync workers partition by source connector; TiDB read replicas absorb explorer/dashboard read load. Graph reads are bounded (depth ≤ 2, limit-capped), so replica lag is the only consistency knob.',
    snippets: [] as string[],
  },
  {
    icon: DatabaseBackup,
    title: 'Backup / restore',
    body: 'Nightly graph snapshot plus WAL shipping; every sync run already produces an immutable snapshot row, so restore is a pointer swap, not a replay.',
    snippets: ['ontos backup', 'ontos restore --snapshot v46'],
  },
  {
    icon: Rocket,
    title: 'Deployment',
    body: 'docker-compose for evaluation (single host, seeded demo data); Helm chart for Kubernetes with separate API/worker/web deployments and per-tenant LLM provider secrets.',
    snippets: ['docker compose up --seed acme', 'helm install ontos ./chart -f values.prod.yaml'],
  },
];

/** ARCH · Scale & ops — three mini-panels with copyable command snippets. */
export function ScaleOps() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {PANELS.map((p, i) => (
        <motion.section
          key={p.title}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ duration: 0.45, delay: i * 0.08, ease: EASE }}
          className="rounded-xl border border-border-hairline bg-bg-panel p-5"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border border-iris/30 bg-iris/10">
              <p.icon className="size-4 text-iris-bright" />
            </span>
            <h3 className="font-display text-[16px] font-semibold text-text-primary">{p.title}</h3>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">{p.body}</p>
          {p.snippets.map((s) => (
            <Snippet key={s} code={s} />
          ))}
        </motion.section>
      ))}
    </div>
  );
}
