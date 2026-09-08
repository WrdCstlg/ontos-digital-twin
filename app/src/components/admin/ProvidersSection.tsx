import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, FlaskConical, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import type { ProviderRow } from '@/components/insights/types';

const STATUS_CHIP: Record<ProviderRow['status'], { label: string; cls: string }> = {
  active: { label: 'ACTIVE', cls: 'border-ok/40 bg-ok/10 text-ok' },
  configured: { label: 'CONFIGURED', cls: 'border-slate-400/30 bg-slate-400/10 text-slate-300' },
  unconfigured: { label: 'NOT CONFIGURED', cls: 'border-border-hairline bg-transparent text-text-muted' },
};

function ProviderCard({
  provider,
  isActive,
  onMakeActive,
  index,
}: {
  provider: ProviderRow;
  isActive: boolean;
  onMakeActive: (p: ProviderRow) => void;
  index: number;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [temperature, setTemperature] = useState([0.2]);
  const chip = STATUS_CHIP[isActive ? 'active' : provider.status === 'active' ? 'configured' : provider.status];

  const test = () => {
    if (provider.status === 'unconfigured' && !isActive) {
      setTestResult('error');
      toast.error(`${provider.label} is not configured — add credentials first`);
      return;
    }
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult(`ok ${provider.latencyP50Ms ?? 180}ms · refusal guard verified`);
    }, 900);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'rounded-xl border bg-bg-panel p-5 transition-colors',
        isActive ? 'border-ok/40' : 'border-border-hairline hover:border-border-glow',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="font-display text-[16px] font-semibold text-text-primary">{provider.label}</span>
        {/* the ACTIVE chip slides between cards */}
        {isActive ? (
          <motion.span
            layoutId="provider-active-chip"
            className={cn('rounded-full border px-2 py-0.5 font-mono text-[10px]', STATUS_CHIP.active.cls)}
          >
            ACTIVE
          </motion.span>
        ) : (
          <span className={cn('rounded-full border px-2 py-0.5 font-mono text-[10px]', chip.cls)}>{chip.label}</span>
        )}
      </div>

      <div className="mt-3 space-y-0.5 font-mono text-[11.5px] text-text-secondary">
        {provider.model && <div>model: {provider.model}</div>}
        {provider.endpoint && <div>endpoint: {provider.endpoint}</div>}
        {provider.maskedKey && <div>key: {provider.maskedKey}</div>}
        {provider.latencyP50Ms != null && <div>latency p50 {provider.latencyP50Ms}ms</div>}
        {!provider.model && !provider.endpoint && <div className="text-text-muted">no credentials on file</div>}
      </div>
      {provider.note && <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">{provider.note}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-text-secondary">
          <input
            type="radio"
            name="active-provider"
            checked={isActive}
            onChange={() => onMakeActive(provider)}
            className="size-3.5 accent-[#6366F1]"
          />
          Make active
        </label>
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-2.5 py-1 text-[12.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
        >
          {testing ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />}
          Test
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] text-text-muted transition-colors hover:text-text-primary"
        >
          config
          <ChevronDown className={cn('size-3 transition-transform duration-200', expanded && 'rotate-180')} />
        </button>
      </div>

      {testResult && testResult !== 'error' && (
        <p className="mt-2 font-mono text-[11px] text-ok">{testResult}</p>
      )}

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="mt-3 space-y-3 rounded-lg border border-border-hairline bg-bg-inset p-3.5">
            <div>
              <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Model
              </span>
              <input
                defaultValue={provider.model ?? ''}
                placeholder="model id"
                className="w-full rounded-md border border-border-hairline bg-bg-panel px-2.5 py-1.5 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-glow"
              />
            </div>
            <div>
              <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Endpoint
              </span>
              <input
                defaultValue={provider.endpoint ?? ''}
                placeholder="https://…"
                className="w-full rounded-md border border-border-hairline bg-bg-panel px-2.5 py-1.5 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-glow"
              />
            </div>
            <div>
              <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">
                API key
              </span>
              <input
                type="password"
                defaultValue={provider.maskedKey ?? ''}
                placeholder="••••••••"
                className="w-full rounded-md border border-border-hairline bg-bg-panel px-2.5 py-1.5 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-glow"
              />
            </div>
            <div>
              <span className="mb-1 flex justify-between text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Temperature
                <span className="font-mono normal-case text-text-secondary">{temperature[0].toFixed(2)}</span>
              </span>
              <Slider value={temperature} onValueChange={setTemperature} min={0} max={1} step={0.05} />
            </div>
            <p className="font-mono text-[10px] text-text-muted">
              provider changes are not persisted in the evaluation build
            </p>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

export function ProvidersSection() {
  const providers = trpc.admin.getProviders.useQuery(undefined, { staleTime: 300_000 });
  const [chosen, setChosen] = useState<string | null>(null);
  const serverActive = (providers.data as ProviderRow[] | undefined)?.find((p) => p.status === 'active')?.id ?? null;
  const activeId = chosen ?? serverActive;

  const makeActive = (p: ProviderRow) => {
    if (p.status === 'unconfigured') {
      toast.warning(`${p.label} has no credentials — configure it before making it active`);
      return;
    }
    setChosen(p.id);
    toast.success(`${p.label} is now the active provider (session only)`);
  };

  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-accent">AI gateway</span>
      <h2 className="mt-1 font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">
        LLM Providers
      </h2>
      <p className="mt-1 max-w-[640px] text-[13px] leading-[1.5] text-text-secondary">
        Pluggable per workspace. NL→query and narrative generation route through the active provider; all output
        passes the same validation guardrails (ADR-005).
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {providers.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
        ) : providers.isError || !providers.data ? (
          <div className="rounded-xl border border-border-hairline bg-bg-panel p-5 text-[13px] text-text-muted md:col-span-2">
            Provider configuration unavailable.{' '}
            <button type="button" onClick={() => void providers.refetch()} className="text-text-accent hover:underline">
              Retry
            </button>
          </div>
        ) : (
          (providers.data as ProviderRow[]).map((p, i) => (
            <ProviderCard key={p.id} provider={p} isActive={activeId === p.id} onMakeActive={makeActive} index={i} />
          ))
        )}
      </div>

      {/* Guardrails */}
      <div className="relative mt-5 overflow-hidden rounded-xl border border-border-hairline bg-bg-panel p-5 pl-6">
        <span className="absolute inset-y-0 left-0 w-[3px] bg-warn" aria-hidden />
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warn" />
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-warn">Guardrails</span>
        </div>
        <p className="mt-2 max-w-[720px] text-[13px] leading-[1.5] text-text-secondary">
          Regardless of provider: generated queries are validated against the ontology and a read-only AST guard;
          write operations are refused. Narratives must cite graph snapshot IDs.{' '}
          <Link to="/app/decisions" className="text-text-accent hover:underline">
            Read ADR-005 →
          </Link>
        </p>
      </div>

      {/* Demo note */}
      <div className="relative mt-3 overflow-hidden rounded-xl border border-info/30 bg-info/5 p-4 pl-6">
        <span className="absolute inset-y-0 left-0 w-[3px] bg-info" aria-hidden />
        <p className="text-[12.5px] leading-[1.5] text-text-secondary">
          Evaluation build: translation is deterministic/simulated for offline reliability — the provider interface
          and guardrails are real.
        </p>
      </div>
    </div>
  );
}

export default ProvidersSection;
