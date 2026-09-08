import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Plus, Settings } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { MODULES } from '@/lib/modules';
import { StatusDot } from '@/components/ui/status-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * WorkspacesSection — tenancy panel. The real workspace comes from
 * admin.getWorkspace with live stats from graph.stats; the sandbox card is
 * clearly marked as not provisioned in this build.
 */
export function WorkspacesSection() {
  const ws = trpc.admin.getWorkspace.useQuery(undefined, { staleTime: 60_000 });
  const stats = trpc.graph.stats.useQuery(undefined, { staleTime: 60_000 });
  const members = trpc.admin.listMembers.useQuery(undefined, { staleTime: 60_000, retry: 1 });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('blank');
  const [region, setRegion] = useState('eu-west');

  const moduleCount = stats.data ? Object.keys(stats.data.byModule).filter((k) => k !== 'cross').length : null;
  const edgeCount = stats.data?.totals.edges;
  const memberCount = members.data?.length;

  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-accent">Multi-tenancy</span>
      <h2 className="mt-1 font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">
        Workspaces
      </h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-[1.5] text-text-secondary">
        Each workspace isolates its ontologies, graphs, mappings, and insights. Storage is partitioned per tenant; no
        cross-workspace queries are possible.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {/* Real workspace card */}
        {ws.isLoading ? (
          <Skeleton className="h-44 w-full rounded-xl" />
        ) : ws.isError || !ws.data ? (
          <div className="rounded-xl border border-border-hairline bg-bg-panel p-5 text-[13px] text-text-muted">
            Workspace metadata unavailable.
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-xl border border-border-hairline bg-bg-panel p-5 transition-colors hover:border-border-glow"
          >
            <div className="flex items-center gap-2.5">
              <StatusDot status="ok" />
              <span className="font-display text-[16px] font-semibold text-text-primary">{ws.data.name}</span>
              <span className="ml-auto rounded-full border border-border-hairline bg-bg-inset px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
                eu-west
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-text-muted">slug: {ws.data.slug} · plan: {ws.data.plan}</p>
            <p className="mt-3 font-mono text-[12px] text-text-secondary">
              {moduleCount ?? '…'} modules · {edgeCount != null ? edgeCount.toLocaleString() : '…'} edges ·{' '}
              {memberCount ?? '…'} members
              {stats.data?.snapshot ? ` · snapshot ${stats.data.snapshot.label}` : ''}
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                to="/app"
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3 py-1.5 text-[13px] font-medium text-white transition-all hover:from-iris hover:to-iris-bright"
              >
                Open <ArrowRight className="size-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => toast.info('Workspace settings are managed via environment config in this build')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
              >
                <Settings className="size-3.5" /> Settings
              </button>
            </div>
          </motion.div>
        )}

        {/* Sandbox — not provisioned in this build */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.09, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-border-hairline bg-bg-panel p-5 opacity-70"
        >
          <div className="flex items-center gap-2.5">
            <StatusDot status="info" pulse={false} />
            <span className="font-display text-[16px] font-semibold text-text-primary">Acme Corp — Sandbox</span>
            <span className="ml-auto rounded-full border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-[10.5px] text-info">
              not provisioned
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-text-muted">single-tenant evaluation build</p>
          <p className="mt-3 font-mono text-[12px] text-text-muted">5 modules · 12k edges · 3 members (illustrative)</p>
          <button
            type="button"
            disabled
            className="mt-4 cursor-not-allowed rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-muted"
            title="Provisioning is disabled in the evaluation build"
          >
            Promote snapshot from Production
          </button>
        </motion.div>

        {/* New workspace — dashed inline create form */}
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => setCreating((c) => !c)}
          className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-glow bg-transparent p-5 text-text-muted transition-colors hover:border-iris/50 hover:text-text-secondary md:col-span-2"
        >
          <Plus className="size-5" />
          <span className="text-[13px]">New workspace</span>
        </motion.button>

        {creating && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden rounded-xl border border-border-hairline bg-bg-panel md:col-span-2"
          >
            <div className="grid gap-3 p-5 sm:grid-cols-3">
              <div>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  Name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="acme-corp-eu"
                  className="w-full rounded-lg border border-border-hairline bg-bg-inset px-3 py-2 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-glow"
                />
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  Template
                </span>
                <Select value={template} onValueChange={setTemplate}>
                  <SelectTrigger className="w-full border-border-hairline bg-bg-inset font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank" className="font-mono text-[12px]">Blank</SelectItem>
                    <SelectItem value="acme-seed" className="font-mono text-[12px]">Demo: Acme seed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  Region
                </span>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className="w-full border-border-hairline bg-bg-inset font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['eu-west', 'eu-central', 'us-east'].map((r) => (
                      <SelectItem key={r} value={r} className="font-mono text-[12px]">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-border-hairline px-5 py-3">
              <button
                type="button"
                onClick={() =>
                  toast.warning('Workspace provisioning is disabled in the evaluation build', {
                    description: name ? `"${name}" (${template}, ${region})` : undefined,
                  })
                }
                className="rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-1.5 text-[13px] font-medium text-white transition-all hover:from-iris hover:to-iris-bright"
              >
                Create workspace
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Isolation diagram */}
      <div className="mt-5 rounded-xl border border-border-hairline bg-bg-inset p-5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
          Tenant isolation
        </span>
        <svg viewBox="0 0 800 190" className="mt-3 w-full" role="img" aria-label="Tenant isolation diagram">
          {/* tenant boxes */}
          {(['Production', 'Sandbox'] as const).map((label, bi) => {
            const x = 20 + bi * 420;
            return (
              <g key={label}>
                <rect
                  x={x}
                  y={18}
                  width={340}
                  height={140}
                  rx={12}
                  fill="#101828"
                  stroke="#1E293B"
                  strokeWidth={1}
                />
                <text x={x + 16} y={42} fill="#94A3B8" fontSize={11} fontFamily="'JetBrains Mono', monospace">
                  tenant: acme-corp-{label.toLowerCase()}
                </text>
                {MODULES.map((m, mi) => {
                  const cx = x + 46 + (mi % 3) * 88;
                  const cy = 82 + Math.floor(mi / 3) * 52;
                  return (
                    <g key={m.key}>
                      <circle cx={cx} cy={cy} r={13} fill={`${m.color}2e`} stroke={m.color} strokeWidth={1.2} />
                      <text
                        x={cx + 20}
                        y={cy + 4}
                        fill="#64748B"
                        fontSize={10}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {m.prefix}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {/* boundary divider */}
          <motion.line
            x1={400}
            y1={10}
            x2={400}
            y2={178}
            stroke="#818CF8"
            strokeWidth={2}
            strokeDasharray="6 5"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
          <rect x={306} y={168} width={188} height={18} rx={9} fill="#0A0F1B" stroke="#334155" strokeWidth={0.5} />
          <text
            x={400}
            y={180.5}
            fill="#A5B4FC"
            fontSize={9.5}
            textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace"
          >
            tenant boundary — enforced at repository layer
          </text>
        </svg>
      </div>
    </div>
  );
}

export default WorkspacesSection;
