import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Loader2, Sparkles, X, Zap } from 'lucide-react';
import { Link } from 'react-router';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { moduleForPrefix, type ModuleKey } from '@/lib/modules';
import { IRIChip } from '@/components/ui/iri-chip';
import { ModuleBadge } from '@/components/ui/module-badge';
import { ObjectActionLinks } from '@/components/actions/ObjectActions';
import { runHref, submissionHref } from '@/components/actions/links';

export interface NodeDrawerProps {
  iri: string | null;
  onClose: () => void;
  /** Navigate the canvas to a neighbor instance */
  onNavigate: (iri: string) => void;
}

const MODULE_KEYS = new Set<string>(['hr', 'legal', 'compliance', 'finance', 'logistics']);

function fmtTs(v: unknown): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-hairline px-4 py-3">
      <div className="pb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">{title}</div>
      {children}
    </div>
  );
}

/**
 * NodeDrawer — 420px right drawer with instance detail: IRIChip header,
 * ModuleBadge, property list, provenance (source mapping + connector +
 * timestamps), expandable raw source record, and clickable neighborhood.
 */
export function NodeDrawer({ iri, onClose, onNavigate }: NodeDrawerProps) {
  const [showSource, setShowSource] = useState(false);
  const q = trpc.graph.getNode.useQuery({ iri: iri ?? '' }, { enabled: !!iri, retry: 1 });
  const data = q.data;

  return (
    <AnimatePresence>
      {iri && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-bg-void/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 440 }}
            animate={{ x: 0 }}
            exit={{ x: 440 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-y-0 right-0 z-[70] flex w-[420px] max-w-[92vw] flex-col border-l border-border-hairline bg-bg-panel"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-border-hairline px-4 py-3">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  {data && (
                    <ModuleBadge module={MODULE_KEYS.has(data.node.moduleKey) ? (data.node.moduleKey as ModuleKey) : 'custom'} />
                  )}
                  {data && <span className="font-mono text-[10px] text-text-muted">#{data.node.id}</span>}
                </div>
                <IRIChip iri={iri} className="max-w-full" />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {q.isLoading && (
                <div className="flex h-40 items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
                  <Loader2 className="size-4 animate-spin text-iris-bright" /> loading instance …
                </div>
              )}
              {q.isError && (
                <div className="m-4 rounded-lg border-l-2 border-risk bg-risk/10 px-3 py-2.5 font-mono text-[12px] text-risk">
                  {q.error.message}
                </div>
              )}
              {data && (
                <>
                  {/* Properties */}
                  <Section title="Properties">
                    <dl className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-[12px] text-text-muted">label</dt>
                        <dd className="truncate text-[13px] text-text-primary">{data.node.label}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-[12px] text-text-muted">class</dt>
                        <dd>
                          <IRIChip iri={data.node.classIri} />
                        </dd>
                      </div>
                      {Object.entries((data.node.propsJson ?? {}) as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-[12px] text-text-muted">{k}</dt>
                          <dd className="truncate font-mono text-[11.5px] text-text-primary" title={String(v)}>
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Section>

                  {/* Actions this object can be the subject of */}
                  <Section title="Actions">
                    <ObjectActionLinks iri={data.node.iri} />
                  </Section>

                  {/* Provenance */}
                  <Section title="Provenance">
                    <dl className="space-y-1.5 text-[12px]">
                      <div className="flex justify-between gap-3">
                        <dt className="text-text-muted">source mapping</dt>
                        <dd className="font-mono text-[11.5px] text-text-primary">
                          {data.provenance.mapping
                            ? data.provenance.mapping.name
                            : data.provenance.submission
                              ? 'an action (below)'
                              : 'manual / seeded'}
                        </dd>
                      </div>
                      {data.provenance.mapping && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-text-muted">source table</dt>
                          <dd className="font-mono text-[11.5px] text-text-secondary">{data.provenance.mapping.sourceTable}</dd>
                        </div>
                      )}
                      {data.provenance.connector && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-text-muted">connector</dt>
                          <dd className="font-mono text-[11.5px] text-text-secondary">
                            {data.provenance.connector.name} · {data.provenance.connector.type}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3">
                        <dt className="text-text-muted">created</dt>
                        <dd className="font-mono text-[11px] text-text-secondary">{fmtTs(data.provenance.createdAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-text-muted">updated</dt>
                        <dd className="font-mono text-[11px] text-text-secondary">{fmtTs(data.provenance.updatedAt)}</dd>
                      </div>
                    </dl>
                    {data.provenance.submission && (
                      <p className="mt-2.5 flex items-start gap-2 rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2 text-[12px] leading-[1.55] text-text-secondary">
                        <Zap className="mt-0.5 size-3.5 shrink-0 text-iris-bright" aria-hidden />
                        <span className="min-w-0 break-words">
                          Last changed by action{' '}
                          <Link to={runHref(data.provenance.submission.actionKey)} className="font-mono text-text-accent hover:underline">
                            {data.provenance.submission.actionKey}
                          </Link>{' '}
                          v{data.provenance.submission.actionVersion},{' '}
                          <Link to={submissionHref(data.provenance.submission.id)} className="font-mono text-text-accent hover:underline">
                            submission #{data.provenance.submission.id}
                          </Link>
                          , by {data.provenance.submission.submittedBy},{' '}
                          <span className="font-mono text-[11px]">{fmtTs(data.provenance.submission.createdAt)}</span>
                        </span>
                      </p>
                    )}
                  </Section>

                  {/* Source record */}
                  <div className="border-t border-border-hairline px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setShowSource((s) => !s)}
                      className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-text-secondary"
                    >
                      {showSource ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      Source record
                    </button>
                    {showSource && (
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border-hairline bg-bg-inset p-2.5 font-mono text-[10.5px] leading-relaxed text-text-secondary">
                        {JSON.stringify(data.node.propsJson ?? {}, null, 2)}
                      </pre>
                    )}
                  </div>

                  {/* Neighborhood */}
                  <Section title={`Neighborhood · ${data.outgoing.length + data.incoming.length} edges`}>
                    <ul className="space-y-1">
                      {data.outgoing.slice(0, 12).map(({ edge, other }) => (
                        <li key={`out-${edge.id}`} className="flex items-center gap-2 text-[12px]">
                          <span
                            className="shrink-0 font-mono text-[10.5px]"
                            style={{ color: moduleForPrefix(edge.predicateIri.split(':')[0]).color }}
                          >
                            —{edge.predicateIri.split(':').pop()}→
                          </span>
                          {other ? (
                            <button
                              type="button"
                              onClick={() => onNavigate(other.iri)}
                              className={cn('truncate font-mono text-[11.5px] text-text-secondary transition-colors hover:text-text-accent hover:underline')}
                            >
                              {other.label}
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] text-text-muted">#{edge.toNodeId}</span>
                          )}
                        </li>
                      ))}
                      {data.incoming.slice(0, 12).map(({ edge, other }) => (
                        <li key={`in-${edge.id}`} className="flex items-center gap-2 text-[12px]">
                          <span
                            className="shrink-0 font-mono text-[10.5px]"
                            style={{ color: moduleForPrefix(edge.predicateIri.split(':')[0]).color }}
                          >
                            ←{edge.predicateIri.split(':').pop()}—
                          </span>
                          {other ? (
                            <button
                              type="button"
                              onClick={() => onNavigate(other.iri)}
                              className="truncate font-mono text-[11.5px] text-text-secondary transition-colors hover:text-text-accent hover:underline"
                            >
                              {other.label}
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] text-text-muted">#{edge.fromNodeId}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Section>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border-hairline px-4 py-3">
              <Link
                to="/app/insights"
                className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-accent transition-colors hover:text-iris-bright"
              >
                <Sparkles className="size-3.5" />
                Find insights about this →
              </Link>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default NodeDrawer;
