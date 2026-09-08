import { motion } from 'framer-motion';
import { Bell, CheckCheck, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModuleBadge } from '@/components/ui/module-badge';
import type { InsightRow } from './types';
import {
  SEVERITY_COLOR,
  formatTimestamp,
  insightModules,
  parseEvidence,
  ruleMetaFor,
  type Severity,
} from './ruleMeta';

const SEVERITY_LABEL: Record<Severity, string> = { risk: 'RISK', warn: 'WARN', info: 'INFO' };

function SeverityChip({ severity }: { severity: Severity }) {
  const color = SEVERITY_COLOR[severity];
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em]"
      style={{ color, backgroundColor: `${color}26`, border: `1px solid ${color}4d` }}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export interface InsightCardProps {
  insight: InsightRow;
  isNew?: boolean;
  onTrace: (insight: InsightRow) => void;
  onAcknowledge: (insight: InsightRow) => void;
  onWatch: (insight: InsightRow) => void;
}

/**
 * InsightCard — one anomaly finding: severity bar + chips, title, mono
 * evidence line with module badges, and trace / acknowledge / watch actions.
 */
export function InsightCard({ insight, isNew, onTrace, onAcknowledge, onWatch }: InsightCardProps) {
  const meta = ruleMetaFor(insight.ruleId);
  const evidence = parseEvidence(insight.evidenceJson);
  const modules = insightModules(insight);
  const color = SEVERITY_COLOR[insight.severity];
  const acknowledged = insight.status === 'acknowledged';

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border-hairline bg-bg-panel p-5 pl-6',
        'transition-colors duration-200 hover:border-border-glow',
        acknowledged && 'opacity-55',
      )}
      aria-label={insight.title}
    >
      {/* severity bar */}
      <motion.span
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-y-0 left-0 w-[3px] origin-top"
        style={{ backgroundColor: color }}
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip severity={insight.severity} />
        <span className="rounded-md border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] text-text-muted">
          {meta.typeChip}
        </span>
        {isNew && (
          <span className="rounded-md border border-warn/40 bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-warn">
            NEW
          </span>
        )}
        {acknowledged && (
          <span className="rounded-md border border-ok/40 bg-ok/10 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-ok">
            ACKNOWLEDGED
          </span>
        )}
        <span className="ml-auto font-mono text-[11.5px] text-text-muted">
          {formatTimestamp(insight.createdAt)}
        </span>
      </div>

      <h3 className="mt-3 font-display text-[18px] font-semibold leading-[1.4] tracking-[-0.01em] text-text-primary">
        {insight.title}
      </h3>
      {insight.summary && (
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-[1.5] text-text-secondary">{insight.summary}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[12px] text-text-muted">
          evidence: {evidence.edgeIds.length} edges · {evidence.nodeIds.length} nodes
          {evidence.missingEdges.length > 0 && ` · ${evidence.missingEdges.length} missing`}
          {insight.ruleId && ` · rule ${insight.ruleId}`}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {modules.map((m) => (
            <ModuleBadge key={m} module={m} />
          ))}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-hairline pt-3">
        <button
          type="button"
          onClick={() => onTrace(insight)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
          style={{
            color,
            borderColor: `${color}59`,
            backgroundColor: `${color}14`,
          }}
        >
          <Waypoints className="size-3.5" /> Trace evidence
        </button>
        {!acknowledged && (
          <button
            type="button"
            onClick={() => onAcknowledge(insight)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
          >
            <CheckCheck className="size-3.5" /> Acknowledge
          </button>
        )}
        <button
          type="button"
          onClick={() => onWatch(insight)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
        >
          <Bell className="size-3.5" /> Create watch rule
        </button>
      </div>
    </motion.article>
  );
}

export default InsightCard;
