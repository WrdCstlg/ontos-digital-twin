import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Link, Service } from '@/lib/landscape';
import {
  KIND_ORDER,
  KIND_STYLE,
  LABEL_H,
  MIN_DIAGRAM_SCALE,
  NODE_H,
  NODE_W,
  TIER_LABEL,
  labelWidth,
  layoutArchitecture,
  tickParts,
} from './meta';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Approximate advance of the 9px mono in the "since" badge. */
const BADGE_CHAR_W = 5.6;

function Ticks({ text }: { text: string }) {
  return (
    <>
      {tickParts(text).map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-bg-panel-raised px-1 text-text-primary">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export interface ArchitectureDiagramProps {
  services: Service[];
  links: Link[];
}

/**
 * The architecture as data: services placed in rows by kind, links drawn and
 * labelled, services new in an increment badged. Hover or focus a service to
 * trace its links; click to pin it in the detail panel.
 */
export function ArchitectureDiagram({ services, links }: ArchitectureDiagramProps) {
  const layout = useMemo(() => layoutArchitecture(services, links), [services, links]);
  const minDiagramWidth = Math.round(layout.width * MIN_DIAGRAM_SCALE);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const [selectedId, setSelectedId] = useState<string>(() => (services.find((s) => s.since) ?? services[0])?.id ?? '');
  const [hoverId, setHoverId] = useState<string | null>(null);

  const activeId = hoverId ?? selectedId;
  const active = byId.get(activeId) ?? null;
  const kindsPresent = KIND_ORDER.filter((k) => services.some((s) => s.kind === k));
  const sinceLabels = [...new Set(services.map((s) => s.since).filter((x): x is string => !!x))];

  const outgoing = links.filter((l) => l.from === activeId && byId.has(l.to));
  const incoming = links.filter((l) => l.to === activeId && byId.has(l.from));

  return (
    <div className="space-y-4">
      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {kindsPresent.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-text-muted">
            <span className={cn('size-2 rounded-sm', KIND_STYLE[k].swatch)} aria-hidden />
            {KIND_STYLE[k].label.toLowerCase()}
          </span>
        ))}
        {sinceLabels.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-full border border-iris/50 bg-iris/15 px-2 py-0.5 font-mono text-[10px] text-text-accent"
          >
            <Sparkles className="size-3" /> new in {label}
          </span>
        ))}
      </div>

      {/*
        The detail panel sits beside the diagram only when both fit with the
        diagram at a legible scale; otherwise it wraps below and the diagram
        takes the full width. (flex-wrap: the diagram's basis is its minimum
        legible width, and it takes nearly all spare space when side by side.)
      */}
      <div className="flex flex-wrap gap-4">
        {/* diagram — scrolls sideways inside the card only when even the full width is too narrow */}
        <div
          className="min-w-0 overflow-x-auto rounded-lg border border-border-hairline bg-bg-inset/50"
          style={{ flex: `999 1 ${minDiagramWidth + 2}px` }}
          data-testid="architecture-diagram"
        >
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="block h-auto w-full"
            style={{ minWidth: minDiagramWidth }}
            role="img"
            aria-label={`Architecture: ${services.length} services and ${links.length} links`}
          >
            <defs>
              <marker id="land-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10" fill="none" className="stroke-text-muted" strokeWidth="1.5" />
              </marker>
              <marker id="land-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10" fill="none" className="stroke-iris-bright" strokeWidth="1.5" />
              </marker>
            </defs>

            {/* row captions */}
            {layout.tiers.map((t) => (
              <text
                key={t.tier}
                x={28}
                y={t.y - 12}
                className="fill-text-muted"
                fontSize={9.5}
                letterSpacing="0.08em"
                fontFamily="'JetBrains Mono', monospace"
              >
                {(TIER_LABEL[t.tier] ?? '').toUpperCase()}
              </text>
            ))}

            {/* links */}
            {layout.edges.map((e, i) => {
              const hot = e.link.from === activeId || e.link.to === activeId;
              // While hovering, links elsewhere step back so the traced ones read.
              const dim = hoverId != null && !hot;
              const labelW = labelWidth(e.link.label);
              return (
                <motion.g
                  key={`${e.link.from}-${e.link.to}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: dim ? 0.35 : 1 }}
                  transition={{ duration: 0.25 }}
                >
                  <line
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    className={hot ? 'stroke-iris-bright' : 'stroke-border-glow'}
                    strokeWidth={hot ? 1.75 : 1.5}
                    markerEnd={hot ? 'url(#land-arrow-hot)' : 'url(#land-arrow)'}
                  />
                  <rect
                    x={e.lx - labelW / 2}
                    y={e.ly - LABEL_H / 2}
                    width={labelW}
                    height={LABEL_H}
                    rx={LABEL_H / 2}
                    className={cn('fill-bg-panel', hot ? 'stroke-iris/60' : 'stroke-border-hairline')}
                    strokeWidth={1}
                  />
                  <text
                    x={e.lx}
                    y={e.ly + 3.5}
                    textAnchor="middle"
                    className={hot ? 'fill-text-accent' : 'fill-text-secondary'}
                    fontSize={10}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {e.link.label}
                  </text>
                </motion.g>
              );
            })}

            {/* services */}
            {layout.nodes.map((n, i) => {
              const s = n.service;
              const k = KIND_STYLE[s.kind];
              const isActive = s.id === activeId;
              const isPinned = s.id === selectedId;
              const badgeW = s.since ? s.since.length * BADGE_CHAR_W + 16 : 0;
              return (
                <motion.g
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: i * 0.05, ease: EASE }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isPinned}
                  aria-label={`${s.name} (${k.label.toLowerCase()})${s.since ? `, new in ${s.since}` : ''}`}
                  onClick={() => setSelectedId(s.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setSelectedId(s.id);
                    }
                  }}
                  onMouseEnter={() => setHoverId(s.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onFocus={() => setHoverId(s.id)}
                  onBlur={() => setHoverId(null)}
                  className="cursor-pointer outline-none"
                >
                  <rect
                    x={n.x}
                    y={n.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={12}
                    className={cn('fill-bg-panel', k.stroke)}
                    strokeOpacity={isActive ? 0.95 : 0.45}
                    strokeWidth={isActive ? 2 : 1.25}
                    strokeDasharray={s.kind === 'external' ? '5 4' : undefined}
                  />
                  <rect x={n.x} y={n.y} width={NODE_W} height={4} rx={2} className={k.fill} fillOpacity={0.8} />
                  <text
                    x={n.x + 14}
                    y={n.y + 24}
                    className={k.fill}
                    fontSize={9.5}
                    letterSpacing="0.08em"
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {k.label.toUpperCase()}
                  </text>
                  {s.since && (
                    <g>
                      <rect
                        x={n.x + NODE_W - badgeW - 10}
                        y={n.y + 12}
                        width={badgeW}
                        height={17}
                        rx={8.5}
                        className="fill-iris/15 stroke-iris/60"
                        strokeWidth={1}
                      />
                      <text
                        x={n.x + NODE_W - badgeW / 2 - 10}
                        y={n.y + 24}
                        textAnchor="middle"
                        className="fill-text-accent"
                        fontSize={9}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {s.since}
                      </text>
                    </g>
                  )}
                  <text
                    x={n.x + 14}
                    y={n.y + 47}
                    className="fill-text-primary"
                    fontSize={15}
                    fontWeight={600}
                    fontFamily="'Space Grotesk', sans-serif"
                  >
                    {s.name}
                  </text>
                  {n.runtimeLines.map((line, j) => (
                    <text
                      key={j}
                      x={n.x + 14}
                      y={n.y + 67 + j * 15}
                      className="fill-text-muted"
                      fontSize={10.5}
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      {line}
                    </text>
                  ))}
                  <title>{`${s.name} — ${s.runtime.replace(/`/g, '')}`}</title>
                </motion.g>
              );
            })}
          </svg>
        </div>

        {/* detail panel */}
        <aside
          className="min-w-0 rounded-lg border border-border-hairline bg-bg-inset p-4"
          style={{ flex: '1 1 300px' }}
          aria-live="polite"
        >
          {active ? (
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
                    KIND_STYLE[active.kind].chip,
                  )}
                >
                  {KIND_STYLE[active.kind].label}
                </span>
                {active.since && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-iris/50 bg-iris/15 px-2 py-0.5 font-mono text-[10px] text-text-accent">
                    <Sparkles className="size-3" /> {active.since}
                  </span>
                )}
              </div>
              <h3 className="mt-2 font-display text-[17px] font-semibold text-text-primary">{active.name}</h3>
              <p className="mt-1 font-mono text-[11.5px] leading-[1.6] text-text-secondary">
                <Ticks text={active.runtime} />
              </p>

              <div className="mt-4 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Responsibilities</div>
              <ul className="mt-1.5 space-y-1.5">
                {active.responsibilities.map((r) => (
                  <li key={r} className="flex gap-2 text-[13px] leading-[1.5] text-text-primary">
                    <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', KIND_STYLE[active.kind].swatch)} aria-hidden />
                    <span>
                      <Ticks text={r} />
                    </span>
                  </li>
                ))}
              </ul>

              {(outgoing.length > 0 || incoming.length > 0) && (
                <>
                  <div className="mt-4 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Links</div>
                  <ul className="mt-1.5 space-y-1">
                    {outgoing.map((l, i) => (
                      <li key={`o-${i}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(l.to)}
                          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-bg-panel-raised"
                        >
                          <ArrowRight className="size-3 shrink-0 text-text-muted" />
                          <span className="text-[12.5px] text-text-primary">{byId.get(l.to)?.name}</span>
                          <span className="ml-auto truncate font-mono text-[10.5px] text-text-muted">{l.label}</span>
                        </button>
                      </li>
                    ))}
                    {incoming.map((l, i) => (
                      <li key={`i-${i}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(l.from)}
                          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-bg-panel-raised"
                        >
                          <ArrowLeft className="size-3 shrink-0 text-text-muted" />
                          <span className="text-[12.5px] text-text-primary">{byId.get(l.from)?.name}</span>
                          <span className="ml-auto truncate font-mono text-[10.5px] text-text-muted">{l.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </motion.div>
          ) : (
            <p className="text-[13px] text-text-muted">Select a service to see what it runs and what it is responsible for.</p>
          )}
        </aside>
      </div>

      {/* every service, selectable without the diagram (narrow screens, keyboard) */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Services">
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelectedId(s.id)}
            aria-pressed={s.id === selectedId}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
              s.id === selectedId
                ? 'border-iris/50 bg-iris/15 text-text-primary'
                : 'border-border-hairline text-text-secondary hover:border-border-glow hover:text-text-primary',
            )}
          >
            <span className={cn('size-1.5 rounded-full', KIND_STYLE[s.kind].swatch)} aria-hidden />
            {s.name}
            {s.since && <Sparkles className="size-3 text-text-accent" aria-label={`new in ${s.since}`} />}
          </button>
        ))}
      </div>
    </div>
  );
}
