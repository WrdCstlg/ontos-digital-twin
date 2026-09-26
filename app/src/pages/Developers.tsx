import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, ExternalLink, KeyRound, Plus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const ROLES = ['viewer', 'editor', 'ontologist', 'admin'] as const;
const EXPIRY = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: null, label: 'Never' },
] as const;

type Endpoint = { method: string; path: string; summary: string; tag: string };

/** GETs the API with the session; the page reads, and only tokens write. */
async function apiGet(path: string): Promise<Response> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `The API answered ${res.status}`);
  }
  return res;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => toast.error('Could not copy: select the text and copy it instead'))
      }
      className="shrink-0 rounded-md border border-border-hairline p-1.5 text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Code({ children, label }: { children: string; label: string }) {
  return (
    <div className="relative rounded-lg border border-border-hairline bg-bg-inset">
      <div className="absolute right-2 top-2">
        <CopyButton text={children} label={label} />
      </div>
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-[12px] leading-relaxed text-text-secondary">{children}</pre>
    </div>
  );
}

function tokenStatus(t: { revokedAt: Date | string | null; expiresAt: Date | string | null }, now: number) {
  if (t.revokedAt) return { label: 'Revoked', tone: 'text-text-muted' };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= now) return { label: 'Expired', tone: 'text-warn' };
  return { label: 'Active', tone: 'text-ok' };
}

const when = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/**
 * Developers — /app/developers. The public Ontology API: its address, the
 * ontology version it serves, API tokens, a TypeScript client and an OpenAPI
 * document generated from this workspace's ontology, and its endpoints.
 */
export default function Developers() {
  const utils = trpc.useUtils();
  const now = useNow(60_000);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const summaryQ = trpc.developer.summary.useQuery(undefined, { retry: 1 });
  const tokensQ = trpc.developer.listTokens.useQuery(undefined, { retry: 1 });
  const openApiQ = useQuery({
    queryKey: ['api-v1', 'openapi', summaryQ.data?.ontologyVersion],
    enabled: !!summaryQ.data,
    queryFn: async () => (await (await apiGet('/openapi.json')).json()) as { paths: Record<string, Record<string, { summary?: string; tags?: string[] }>> },
  });

  const endpoints = useMemo<Endpoint[]>(() => {
    const paths = openApiQ.data?.paths ?? {};
    return Object.entries(paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ method: method.toUpperCase(), path, summary: op.summary ?? '', tag: op.tags?.[0] ?? 'Other' })),
    );
  }, [openApiQ.data]);

  /* ── creating a token ── */
  const [name, setName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('viewer');
  const [scopes, setScopes] = useState<{ read: boolean; actions: boolean }>({ read: true, actions: false });
  const [expiry, setExpiry] = useState<number | null>(90);
  const [modules, setModules] = useState('');
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);
  const create = trpc.developer.createToken.useMutation({
    onSuccess: (res) => {
      setRevealed({ token: res.token, name: res.row.name });
      setName('');
      void utils.developer.listTokens.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const chosenScopes = (['read', 'actions'] as const).filter((s) => scopes[s]);
  const moduleScope = modules
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const canCreate = name.trim().length > 0 && chosenScopes.length > 0 && !create.isPending;

  /* ── revoking ── */
  const [revoking, setRevoking] = useState<{ id: number; name: string } | null>(null);
  const revoke = trpc.developer.revokeToken.useMutation({
    onSuccess: () => {
      toast.success('Token revoked. Requests with it are refused from now on.');
      void utils.developer.listTokens.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  /* ── downloading the client ── */
  const [downloading, setDownloading] = useState(false);
  const downloadSdk = async () => {
    setDownloading(true);
    try {
      const blob = await (await apiGet('/sdk.ts')).blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'ontos-client.ts' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The client could not be downloaded');
    } finally {
      setDownloading(false);
    }
  };

  const s = summaryQ.data;
  const base = `${origin}${s?.basePath ?? '/api/v1'}`;
  const exampleType = s?.example.objectType;
  const exampleAction = s?.example.action;
  const tsExample = [
    `import { OntosClient } from "./ontos-client";`,
    ``,
    `const ontos = new OntosClient({ baseUrl: "${origin}", token: process.env.ONTOS_TOKEN! });`,
    ...(exampleType
      ? [``, `// Every ${exampleType.iri}, page by page, subclasses included`, `for await (const object of ontos.iterate("${exampleType.iri}")) {`, `  console.log(object.label, object.properties);`, `}`]
      : []),
    ...(exampleAction
      ? [
          ``,
          `// Applied, or recorded with the reasons it was not`,
          `const result = await ontos.actions.submit("${exampleAction.key}", {`,
          ...exampleAction.params.map((p) => `  ${p.name}: ${p.type === 'number' ? '0' : p.type === 'boolean' ? 'true' : p.type === 'date' ? '"2027-01-01"' : '"…"'},`),
          `});`,
          `console.log(result.submission.status);`,
        ]
      : []),
  ].join('\n');
  const curlExample = `curl -H "Authorization: Bearer $ONTOS_TOKEN" \\\n  "${base}${exampleType ? `${exampleType.path}?limit=5` : '/ontology'}"`;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <Toaster position="bottom-right" theme="dark" />

      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
        <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">Developers</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-text-secondary">
          The Ontology API: read objects by type and submit actions from other systems, with a client and an OpenAPI
          document generated from this workspace&apos;s ontology. Writes go through action types, so every change is
          checked, recorded and audited.
        </p>
      </motion.header>

      {/* ── Where the API is ── */}
      <section aria-label="API summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border-hairline bg-bg-panel p-4 sm:col-span-2">
          <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">Base URL</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[14px] text-text-primary">{base}</code>
            <CopyButton text={base} label="Copy the base URL" />
          </div>
        </div>
        <div className="rounded-xl border border-border-hairline bg-bg-panel p-4">
          <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">Ontology version</div>
          <div className="mt-1 font-mono text-[14px] text-text-primary">{s?.ontologyVersion ?? '…'}</div>
        </div>
        <div className="rounded-xl border border-border-hairline bg-bg-panel p-4">
          <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">Serves</div>
          <div className="mt-1 text-[14px] text-text-primary">
            {s ? `${s.objectTypes} object types · ${s.actionTypes} action types` : '…'}
          </div>
        </div>
      </section>
      {summaryQ.error && <p role="alert" className="text-[13px] text-risk">{summaryQ.error.message}</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Tokens ── */}
        <section aria-label="API tokens" className="space-y-4 rounded-xl border border-border-hairline bg-bg-panel p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-iris" />
            <h2 className="font-display text-[20px] font-semibold text-text-primary">API tokens</h2>
          </div>
          <p className="text-[13px] text-text-secondary">
            A token acts in this workspace with the role you give it, never higher than your own now: if your access
            changes, so does the token&apos;s. Send it as <code className="font-mono">Authorization: Bearer …</code>.
          </p>

          {revealed && (
            <div role="status" className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-4">
              <div className="flex items-center gap-2 text-[13px] font-medium text-warn">
                <TriangleAlert className="size-4" /> Copy &ldquo;{revealed.name}&rdquo; now. It will not be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code data-testid="new-token" className="min-w-0 flex-1 break-all rounded-md bg-bg-inset px-3 py-2 font-mono text-[12.5px] text-text-primary">
                  {revealed.token}
                </code>
                <CopyButton text={revealed.token} label="Copy the new token" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
                I have stored it
              </Button>
            </div>
          )}

          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canCreate) return;
              create.mutate({ name: name.trim(), role, scopes: [...chosenScopes], expiresInDays: expiry, moduleScope: moduleScope.length ? moduleScope : null });
            }}
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="token-name">Name</Label>
              <Input id="token-name" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} placeholder="e.g. Contracts sync (CI)" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-role">Role</Label>
              <select id="token-role" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className="h-9 w-full rounded-md border border-border-hairline bg-bg-inset px-2 text-[13px] text-text-primary">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-expiry">Expires</Label>
              <select id="token-expiry" value={expiry ?? 'never'} onChange={(e) => setExpiry(e.target.value === 'never' ? null : Number(e.target.value))} className="h-9 w-full rounded-md border border-border-hairline bg-bg-inset px-2 text-[13px] text-text-primary">
                {EXPIRY.map((x) => (
                  <option key={x.label} value={x.days ?? 'never'}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Scopes</legend>
              <div className="flex gap-4 text-[13px] text-text-secondary">
                {(['read', 'actions'] as const).map((sc) => (
                  <label key={sc} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={scopes[sc]} onChange={(e) => setScopes((p) => ({ ...p, [sc]: e.target.checked }))} />
                    {sc === 'read' ? 'Read objects' : 'Submit actions'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="token-modules">Modules (optional)</Label>
              <Input id="token-modules" value={modules} onChange={(e) => setModules(e.target.value)} placeholder="e.g. hr, legal — empty for all" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={!canCreate}>
                <Plus className="size-4" /> {create.isPending ? 'Creating…' : 'Create token'}
              </Button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Token</th>
                  <th className="py-2 pr-3">Role · scopes</th>
                  <th className="py-2 pr-3">Created by</th>
                  <th className="py-2 pr-3">Last used</th>
                  <th className="py-2 pr-3">Expires</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {(tokensQ.data ?? []).map((t) => {
                  const st = tokenStatus(t, now);
                  return (
                    <tr key={t.id} className="border-t border-border-hairline">
                      <td className="py-2 pr-3 text-text-primary">{t.name}</td>
                      <td className="py-2 pr-3 font-mono text-text-muted">{t.prefix}…</td>
                      <td className="py-2 pr-3 text-text-secondary">
                        {t.role} · {Array.isArray(t.scopes) ? (t.scopes as string[]).join(', ') : ''}
                      </td>
                      <td className="py-2 pr-3 text-text-secondary">{t.createdBy}</td>
                      <td className="py-2 pr-3 text-text-secondary">{when(t.lastUsedAt)}</td>
                      <td className="py-2 pr-3 text-text-secondary">{t.expiresAt ? when(t.expiresAt) : 'Never'}</td>
                      <td className={cn('py-2 pr-3', st.tone)}>{st.label}</td>
                      <td className="py-2 text-right">
                        {st.label === 'Active' && (
                          <Button variant="ghost" size="sm" onClick={() => setRevoking({ id: t.id, name: t.name })}>
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {tokensQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-text-muted">
                      No tokens yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Using the API ── */}
        <section aria-label="Using the API" className="space-y-4 rounded-xl border border-border-hairline bg-bg-panel p-5">
          <h2 className="font-display text-[20px] font-semibold text-text-primary">Using the API</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void downloadSdk()} disabled={downloading || !s}>
              <Download className="size-4" /> {downloading ? 'Generating…' : 'TypeScript client'}
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> OpenAPI document
              </a>
            </Button>
          </div>
          <p className="text-[13px] text-text-secondary">
            The client is one file with no dependencies, typed per object type and action type. It knows the ontology
            version it was generated from, and warns when the server&apos;s differs: download it again then.
          </p>
          <Code label="Copy the TypeScript example">{tsExample}</Code>
          <Code label="Copy the curl example">{curlExample}</Code>

          <h3 className="pt-2 font-display text-[16px] font-semibold text-text-primary">Endpoints</h3>
          {openApiQ.error && <p role="alert" className="text-[13px] text-risk">{(openApiQ.error as Error).message}</p>}
          <ul aria-label="Endpoints" className="divide-y divide-border-hairline">
            {endpoints.map((e) => (
              <li key={`${e.method} ${e.path}`} className="flex items-baseline gap-3 py-1.5">
                <span className={cn('w-12 shrink-0 font-mono text-[11px] font-semibold', e.method === 'GET' ? 'text-info' : 'text-warn')}>{e.method}</span>
                <code className="min-w-0 break-all font-mono text-[12px] text-text-primary">{e.path}</code>
                <span className="ml-auto hidden shrink-0 text-[12px] text-text-muted md:inline">{e.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &ldquo;{revoking?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>Every system using this token is refused from now on. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => revoking && revoke.mutate({ id: revoking.id })}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
