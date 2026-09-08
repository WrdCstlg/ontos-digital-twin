import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, EllipsisVertical, KeyRound, LogIn, Minus, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { LOGIN_PATH } from '@/const';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { moduleForPrefix, type ModuleKey } from '@/lib/modules';
import { ModuleBadge } from '@/components/ui/module-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MemberRow } from '@/components/insights/types';
import { formatTimestamp } from '@/components/insights/ruleMeta';

/* ── Static permission model (designed representation) ────────── */

type Role = 'viewer' | 'editor' | 'ontologist' | 'admin';

const ROLES: { key: Role; label: string; color: string; blurb: string }[] = [
  { key: 'viewer', label: 'Viewer', color: '#94A3B8', blurb: 'Read-only across the graph, mappings, insights, and audit trail.' },
  { key: 'editor', label: 'Editor', color: '#38BDF8', blurb: 'Maintains connectors and mappings, runs syncs; cannot touch the ontology.' },
  { key: 'ontologist', label: 'Ontologist', color: '#818CF8', blurb: 'Extends and publishes ontology modules; cannot manage members.' },
  { key: 'admin', label: 'Admin', color: '#FBBF24', blurb: 'Full control — members, connectors, LLM providers, and workspace settings.' },
];

const CAPABILITIES: { label: string; allowed: Role[] }[] = [
  { label: 'View graph', allowed: ['viewer', 'editor', 'ontologist', 'admin'] },
  { label: 'Edit mappings', allowed: ['editor', 'ontologist', 'admin'] },
  { label: 'Run sync', allowed: ['editor', 'ontologist', 'admin'] },
  { label: 'Edit ontology', allowed: ['ontologist', 'admin'] },
  { label: 'Publish version', allowed: ['ontologist', 'admin'] },
  { label: 'Manage connectors', allowed: ['editor', 'admin'] },
  { label: 'Manage members', allowed: ['admin'] },
  { label: 'Configure LLM', allowed: ['admin'] },
  { label: 'Export data', allowed: ['editor', 'ontologist', 'admin'] },
];

const ROLE_CHIP: Record<Role, string> = {
  viewer: 'border-slate-400/30 bg-slate-400/15 text-slate-300',
  editor: 'border-sky-400/30 bg-sky-400/15 text-sky-300',
  ontologist: 'border-iris/40 bg-iris/15 text-text-accent',
  admin: 'border-amber-400/30 bg-amber-400/15 text-amber-300',
};

function PermissionMatrix() {
  const [hoverCol, setHoverCol] = useState<Role | null>(null);
  let cellIdx = 0;
  return (
    <div className="overflow-x-auto rounded-xl border border-border-hairline">
      <table className="w-full min-w-[560px] text-left">
        <thead className="sticky top-0 bg-bg-panel">
          <tr className="border-b border-border-hairline">
            <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Capability
            </th>
            {ROLES.map((r) => (
              <th
                key={r.key}
                onMouseEnter={() => setHoverCol(r.key)}
                onMouseLeave={() => setHoverCol(null)}
                className={cn(
                  'relative px-4 py-2.5 text-center text-[11px] font-medium uppercase tracking-[0.06em] transition-colors',
                  hoverCol === r.key ? 'text-text-primary' : 'text-text-muted',
                  r.key === 'admin' && 'bg-iris/10',
                )}
              >
                <span style={{ color: r.color }}>{r.label}</span>
                {hoverCol === r.key && (
                  <div className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-lg border border-border-hairline bg-bg-panel-raised p-3 text-left normal-case tracking-normal shadow-xl">
                    <div className="text-[12px] font-semibold text-text-primary">{r.label}</div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">{r.blurb}</p>
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map((cap) => (
            <tr key={cap.label} className="border-b border-border-hairline/60 transition-colors hover:bg-bg-panel-raised/40">
              <td className="px-4 py-2 text-[13px] text-text-secondary">{cap.label}</td>
              {ROLES.map((r) => {
                const allowed = cap.allowed.includes(r.key);
                const idx = cellIdx++;
                return (
                  <td
                    key={r.key}
                    className={cn(
                      'px-4 py-2 text-center transition-colors',
                      hoverCol === r.key && 'bg-bg-panel-raised/60',
                      r.key === 'admin' && 'bg-iris/10',
                    )}
                  >
                    <motion.span
                      initial={{ scale: 0, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.02, type: 'spring', stiffness: 400, damping: 22 }}
                      className="inline-flex"
                    >
                      {allowed ? (
                        <span className="flex size-4 items-center justify-center rounded-full bg-ok/20">
                          <Check className="size-2.5 text-ok" />
                        </span>
                      ) : (
                        <Minus className="size-3.5 text-slate-600" />
                      )}
                    </motion.span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Members table (real data) ────────────────────────────────── */

function parseScope(scope: unknown): ModuleKey[] {
  if (!Array.isArray(scope)) return [];
  return scope
    .filter((s): s is string => typeof s === 'string')
    .map((s) => (moduleForPrefix(s).key === 'custom' && !['custom'].includes(s) ? s : moduleForPrefix(s).key))
    .map((s) => (['hr', 'legal', 'compliance', 'finance', 'logistics', 'custom'].includes(s) ? s : 'custom')) as ModuleKey[];
}

function initials(name?: string | null) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

function MembersTable() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const members = trpc.admin.listMembers.useQuery(undefined, { retry: 1 });
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  const updateRole = trpc.admin.updateMemberRole.useMutation({
    onMutate: (vars) => setPendingId(vars.memberId),
    onSuccess: () => {
      void utils.admin.listMembers.invalidate();
      setPendingId(null);
    },
    onError: (err) => {
      setPendingId(null);
      const code = (err as { data?: { code?: string } }).data?.code;
      if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
        toast.error('Role changes require sign-in', {
          action: { label: 'Sign in', onClick: () => (window.location.href = LOGIN_PATH) },
        });
      } else {
        toast.error('Could not change the member role', { description: err.message });
      }
    },
  });

  const changeRole = (m: MemberRow, role: Role) => {
    if (role === m.role) return;
    updateRole.mutate(
      { memberId: m.id, role },
      {
        onSuccess: () => {
          setSavedId(m.id);
          setTimeout(() => setSavedId(null), 1200);
        },
      },
    );
  };

  if (members.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (members.isError) {
    return (
      <div className="rounded-xl border border-border-hairline bg-bg-panel p-5 text-[13px] text-text-muted">
        The member list could not be loaded.{' '}
        <button type="button" onClick={() => void members.refetch()} className="text-text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const rows = (members.data ?? []) as MemberRow[];
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border-hairline bg-bg-panel/50 px-6 py-10 text-center">
        <ShieldCheck className="size-6 text-text-muted" />
        <p className="mt-3 text-[14px] text-text-secondary">No members in this workspace yet.</p>
        <p className="mt-1 max-w-[420px] font-mono text-[11.5px] leading-relaxed text-text-muted">
          members appear here once users sign in and are provisioned into acme-corp-production
        </p>
        {!isAuthenticated && (
          <Link
            to={LOGIN_PATH}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-3.5 py-2 text-[13px] font-medium text-text-accent transition-colors hover:bg-iris/25"
          >
            <LogIn className="size-3.5" /> Sign in to provision your account
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-hairline">
      <table className="w-full min-w-[720px] text-left">
        <thead>
          <tr className="border-b border-border-hairline">
            {['Member', 'Role', 'Module scope', 'Last active', ''].map((h) => (
              <th key={h} className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              className={cn(
                'border-b border-border-hairline/60 transition-colors',
                pendingId === m.id && 'bg-warn/5',
                savedId === m.id && 'bg-ok/5',
              )}
            >
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  {m.user?.avatar ? (
                    <img src={m.user.avatar} alt="" className="size-7 rounded-full border border-border-hairline" />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-iris-deep to-iris font-display text-[10px] font-semibold text-white">
                      {initials(m.user?.name)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {m.user?.name ?? `user #${m.userId}`}
                    </div>
                    <div className="truncate font-mono text-[11px] text-text-muted">{m.user?.email ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <Select value={m.role} onValueChange={(v) => changeRole(m, v as Role)} disabled={pendingId === m.id}>
                  <SelectTrigger
                    className={cn(
                      'h-7 w-[128px] rounded-full border px-2.5 font-mono text-[11px] uppercase tracking-[0.06em]',
                      ROLE_CHIP[m.role],
                    )}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.key} value={r.key} className="font-mono text-[12px]">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {parseScope(m.moduleScope).length > 0 ? (
                    parseScope(m.moduleScope).map((k) => <ModuleBadge key={k} module={k} />)
                  ) : (
                    <span className="font-mono text-[11px] text-text-muted">all modules</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 font-mono text-[11.5px] text-text-muted">
                {m.user?.lastSignInAt ? formatTimestamp(m.user.lastSignInAt) : 'never'}
              </td>
              <td className="px-2 py-2.5 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Member actions"
                      className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
                    >
                      <EllipsisVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="border-border-hairline bg-bg-panel-raised">
                    <DropdownMenuItem onSelect={() => toast.info('MFA reset is decorative in the evaluation build')}>
                      Reset MFA
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-risk"
                      onSelect={() => toast.warning('Member removal is disabled in the evaluation build')}
                    >
                      Remove from workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── SSO panel (decorative hooks per design) ──────────────────── */

function SsoPanel() {
  return (
    <div className="rounded-xl border border-border-hairline bg-bg-panel p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-text-muted" />
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
          Single sign-on
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-hairline bg-bg-inset p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[13px] text-text-primary">OIDC</span>
            <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[10px] text-ok">
              Configured — Okta
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-text-muted">issuer: https://acme.okta.com · groups claim</p>
        </div>
        <div className="rounded-lg border border-border-hairline bg-bg-inset p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[13px] text-text-primary">SAML</span>
            <span className="rounded-full border border-border-hairline px-2 py-0.5 font-mono text-[10px] text-text-muted">
              Not configured
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-text-muted">metadata url: —</p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {[
          ['okta:ontologists', 'Ontologist'],
          ['okta:data-engineering', 'Editor'],
          ['okta:platform-admins', 'Admin'],
        ].map(([group, role]) => (
          <div
            key={group}
            className="flex items-center justify-between rounded-lg border border-border-hairline/60 px-3 py-1.5 font-mono text-[11.5px]"
          >
            <span className="text-text-secondary">{group}</span>
            <span className="text-text-muted">
              → <span className="text-text-accent">{role}</span>
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => toast.info('SSO test flow is decorative in the evaluation build')}
        className="mt-4 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
      >
        Test login flow
      </button>
    </div>
  );
}

export function RbacSection() {
  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-accent">RBAC</span>
      <h2 className="mt-1 font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">
        Roles & Permissions
      </h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-[1.5] text-text-secondary">
        Four built-in roles with per-module and per-graph scopes. SSO via OIDC/SAML maps groups to roles.
      </p>

      <div className="mt-5">
        <PermissionMatrix />
      </div>

      <h3 className="mt-7 font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">Members</h3>
      <div className="mt-3">
        <MembersTable />
      </div>

      <div className="mt-7">
        <SsoPanel />
      </div>
    </div>
  );
}

export default RbacSection;
