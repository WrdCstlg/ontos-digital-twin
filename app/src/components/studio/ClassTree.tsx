import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRight,
  CirclePlus,
  MoreHorizontal,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildClassTree,
  prefixOf,
  type ClassTreeNode,
  type StudioClass,
} from './studio-utils';

export interface ClassTreeProps {
  classes: StudioClass[];
  moduleColor: string;
  modulePrefix: string;
  selectedIri: string | null;
  flashIri: string | null;
  onSelect: (iri: string) => void;
  onAddClass: (parentIri?: string) => void;
  onDeprecate: (cls: StudioClass) => void;
  onAddPropertyInfo: () => void;
}

interface RowProps {
  node: ClassTreeNode;
  depth: number;
  color: string;
  selectedIri: string | null;
  flashIri: string | null;
  filter: string;
  expanded: Set<string>;
  toggle: (iri: string) => void;
  onSelect: (iri: string) => void;
  onAddClass: (parentIri?: string) => void;
  onDeprecate: (cls: StudioClass) => void;
  nextIndex: () => number;
}

function matches(node: ClassTreeNode, filter: string): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  if (node.cls.label.toLowerCase().includes(f) || node.cls.iri.toLowerCase().includes(f)) return true;
  return node.children.some((c) => matches(c, f));
}

function TreeRow(props: RowProps) {
  const { node, depth, color, selectedIri, flashIri, filter, expanded, toggle, onSelect, onAddClass, onDeprecate } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const { cls } = node;
  if (!matches(node, filter)) return null;

  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(cls.iri) || !!filter;
  const isSelected = selectedIri === cls.iri;
  const isFlash = flashIri === cls.iri;
  const staggerIndex = props.nextIndex();

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, delay: Math.min(staggerIndex, 16) * 0.025, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'group relative flex h-8 items-center gap-1 rounded-md pr-2 text-left transition-colors duration-150',
          isSelected ? 'bg-bg-panel-raised' : 'hover:bg-bg-panel-raised/60',
        )}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {isFlash && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-0 rounded-md bg-warn/40"
          />
        )}
        {/* twisty */}
        <button
          type="button"
          aria-label={isOpen ? `Collapse ${cls.label}` : `Expand ${cls.label}`}
          onClick={() => hasChildren && toggle(cls.iri)}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded transition-transform duration-200',
            hasChildren ? 'text-text-muted hover:text-text-primary' : 'invisible',
          )}
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform duration-200', isOpen && 'rotate-90')}
            style={{ color: hasChildren ? color : undefined }}
          />
        </button>
        {/* select row */}
        <button
          type="button"
          onClick={() => onSelect(cls.iri)}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          <span
            className={cn(
              'truncate text-[13px]',
              cls.deprecated ? 'text-text-muted line-through' : 'text-text-primary',
            )}
          >
            <span className="font-mono text-[11px]" style={{ color }}>
              {prefixOf(cls.iri)}:
            </span>
            {cls.label}
          </span>
          {cls.isCustom && !cls.deprecated && (
            <span className="shrink-0 rounded border border-warn/40 bg-warn/15 px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-[0.08em] text-warn">
              new
            </span>
          )}
          {cls.deprecated && (
            <span title="Deprecated — instances remain until migration">
              <TriangleAlert className="size-3 shrink-0 text-warn" aria-label="Deprecated" />
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-text-muted">
            {cls.instanceCount}
          </span>
        </button>
        {/* ⋯ menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={`Actions for ${cls.label}`}
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-bg-panel hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-hidden
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border border-border-hairline bg-bg-panel-raised py-1 shadow-xl">
                <MenuItem
                  label="Add subclass"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddClass(cls.iri);
                  }}
                />
                <MenuItem label="Rename" disabled hint="Not supported in this build" />
                <MenuItem
                  label="Deprecate"
                  danger
                  disabled={cls.deprecated}
                  hint={cls.deprecated ? 'Already deprecated' : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    onDeprecate(cls);
                  }}
                />
                <MenuItem label="Delete" disabled hint="Not supported in this build" />
              </div>
            </>
          )}
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {hasChildren && isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <TreeRow key={child.cls.iri} {...props} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
  disabled,
  hint,
}: {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={cn(
        'flex w-full items-center px-3 py-1.5 text-left text-[12.5px] transition-colors',
        disabled
          ? 'cursor-not-allowed text-text-muted/50'
          : danger
            ? 'text-risk hover:bg-risk/10'
            : 'text-text-secondary hover:bg-bg-panel hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}

/**
 * ClassTree — left pane of the Studio: mono search filter, add buttons and
 * a collapsible owl:Thing-rooted class hierarchy with instance counts,
 * deprecated styling and per-row context menus.
 */
export function ClassTree({
  classes,
  moduleColor,
  modulePrefix,
  selectedIri,
  flashIri,
  onSelect,
  onAddClass,
  onDeprecate,
  onAddPropertyInfo,
}: ClassTreeProps) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildClassTree(classes), [classes]);

  const toggle = (iri: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(iri)) next.delete(iri);
      else next.add(iri);
      return next;
    });

  let counter = 0;
  const nextIndex = () => counter++;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* search + add buttons */}
      <div className="flex items-center gap-1.5 border-b border-border-hairline p-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border-hairline bg-bg-inset px-2 py-1">
          <Search className="size-3 shrink-0 text-text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter classes…"
            className="w-full min-w-0 bg-transparent font-mono text-[11.5px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <button
          type="button"
          title="New class"
          onClick={() => onAddClass()}
          className="rounded-md border border-border-hairline p-1.5 text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
        >
          <CirclePlus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Properties are created alongside classes in this build"
          onClick={onAddPropertyInfo}
          className="rounded-md border border-border-hairline p-1.5 text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
        >
          <span className="font-mono text-[10px] font-semibold leading-none">P+</span>
        </button>
      </div>

      {/* tree */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {/* virtual owl:Thing root */}
        <div
          className="flex h-8 items-center gap-1 rounded-md px-1.5"
          style={{ paddingLeft: 6 }}
        >
          <span className="flex size-4 items-center justify-center">
            <ChevronRight className="size-3.5 rotate-90 text-text-muted" />
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-text-muted" aria-hidden />
            <span className="text-[13px] text-text-secondary">
              <span className="font-mono text-[11px] text-text-muted">owl:</span>Thing
            </span>
          </span>
        </div>
        {tree.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-text-muted">
            No classes in this module yet.
          </p>
        ) : (
          tree.map((node) => (
            <TreeRow
              key={node.cls.iri}
              node={node}
              depth={1}
              color={moduleColor}
              selectedIri={selectedIri}
              flashIri={flashIri}
              filter={filter}
              expanded={expanded}
              toggle={toggle}
              onSelect={onSelect}
              onAddClass={onAddClass}
              onDeprecate={onDeprecate}
              nextIndex={nextIndex}
            />
          ))
        )}
      </div>

      <div className="border-t border-border-hairline px-3 py-1.5 font-mono text-[10px] text-text-muted">
        {classes.length} classes · prefix <span style={{ color: moduleColor }}>{modulePrefix}:</span>
      </div>
    </div>
  );
}

export default ClassTree;
