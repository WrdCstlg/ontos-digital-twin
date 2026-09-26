/**
 * ⌘K Command Palette — global search across the entire workspace.
 *
 * Opens with ⌘K (Mac) or Ctrl+K (Windows/Linux).
 * Searches knowledge graph nodes, ontology classes/properties,
 * insights, action types, and connectors in real-time via tRPC.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData } from '@tanstack/react-query';
import { Command as CommandPrimitive } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Box,
  Database,
  Hash,
  Layers,
  Loader2,
  Search,
  Shapes,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { getModule, type ModuleKey } from '@/lib/modules';

/* ── category metadata ───────────────────────────────────────── */

type SearchCategory = 'instance' | 'class' | 'property' | 'insight' | 'action' | 'connector';

const CATEGORY_META: Record<SearchCategory, { icon: typeof Box; label: string; color: string }> = {
  instance: { icon: Box, label: 'Instances', color: '#38BDF8' },
  class: { icon: Shapes, label: 'Classes', color: '#A78BFA' },
  property: { icon: Hash, label: 'Properties', color: '#34D399' },
  insight: { icon: AlertTriangle, label: 'Insights', color: '#FB7185' },
  action: { icon: Zap, label: 'Actions', color: '#FBBF24' },
  connector: { icon: Database, label: 'Connectors', color: '#F472B6' },
};

/* ── debounce hook ───────────────────────────────────────────── */

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/* ── component ───────────────────────────────────────────────── */

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 200);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // tRPC search query — only fires when debounced query is non-empty
  const searchQuery = trpc.search.global.useQuery(
    { query: debouncedQuery },
    {
      enabled: open && debouncedQuery.length > 0,
      staleTime: 30_000,
      // Keep the last results on screen while the next query loads.
      placeholderData: keepPreviousData,
    },
  );

  const results = searchQuery.data?.results ?? [];
  const isSearching = searchQuery.isFetching;

  // Group results by category
  const grouped = results.reduce(
    (acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category].push(r);
      return acc;
    },
    {} as Record<SearchCategory, typeof results>,
  );

  const categories = Object.keys(grouped) as SearchCategory[];

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => setQuery(''), 150);
    }
  }, [open]);

  // Navigate to result
  const handleSelect = useCallback(
    (href: string) => {
      onOpenChange(false);
      navigate(href);
    },
    [navigate, onOpenChange],
  );

  // Module color helper
  const moduleColor = (moduleKey: string | null): string => {
    if (!moduleKey) return 'var(--text-muted)';
    try {
      return getModule(moduleKey as ModuleKey).color;
    } catch {
      return 'var(--text-muted)';
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-[min(20vh,180px)] z-[101] w-full max-w-[640px] -translate-x-1/2"
          >
            <CommandPrimitive
              className="overflow-hidden rounded-xl border border-border-hairline bg-bg-panel shadow-2xl shadow-black/40"
              shouldFilter={false}
              loop
            >
              {/* Search input */}
              <div className="flex items-center gap-3 border-b border-border-hairline px-4 py-3">
                {isSearching ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-iris" />
                ) : (
                  <Search className="size-4 shrink-0 text-text-muted" />
                )}
                <CommandPrimitive.Input
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search classes, instances, insights, actions…"
                  className="flex-1 bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-muted"
                  autoFocus
                />
                <kbd className="hidden rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] text-text-muted sm:inline">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <CommandPrimitive.List className="max-h-[min(50vh,400px)] overflow-y-auto overscroll-contain p-1.5">
                {debouncedQuery.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Layers className="mb-3 size-8 text-text-muted/60" />
                    <p className="text-[13px] text-text-muted">
                      Search across your entire workspace
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-text-muted/60">
                      instances · classes · properties · insights · actions · connectors
                    </p>
                  </div>
                ) : results.length === 0 && !isSearching ? (
                  <CommandPrimitive.Empty className="flex flex-col items-center justify-center py-12 text-center">
                    <Search className="mb-3 size-6 text-text-muted/40" />
                    <p className="text-[13px] text-text-muted">
                      No results for "<span className="text-text-primary">{debouncedQuery}</span>"
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted/60">
                      Try a different term or fewer characters
                    </p>
                  </CommandPrimitive.Empty>
                ) : (
                  categories.map((cat) => {
                    const meta = CATEGORY_META[cat];
                    const items = grouped[cat];
                    return (
                      <CommandPrimitive.Group
                        key={cat}
                        heading={
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            <meta.icon className="size-3" style={{ color: meta.color }} />
                            <span
                              className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                              style={{ color: meta.color }}
                            >
                              {meta.label}
                            </span>
                            <span className="font-mono text-[10px] text-text-muted">
                              {items.length}
                            </span>
                          </div>
                        }
                      >
                        {items.map((item) => {
                          const Icon = CATEGORY_META[item.category].icon;
                          const color = item.moduleKey
                            ? moduleColor(item.moduleKey)
                            : CATEGORY_META[item.category].color;
                          return (
                            <CommandPrimitive.Item
                              key={`${item.category}-${item.id}`}
                              value={`${item.category}:${item.title}`}
                              onSelect={() => handleSelect(item.href)}
                              className={cn(
                                'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                                'aria-selected:bg-iris/10',
                              )}
                            >
                              <span
                                className="flex size-7 shrink-0 items-center justify-center rounded-md"
                                style={{
                                  backgroundColor: `${color}15`,
                                  color,
                                }}
                              >
                                <Icon className="size-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-text-primary group-aria-selected:text-text-accent">
                                  {item.title}
                                </span>
                                <span className="block truncate font-mono text-[10.5px] text-text-muted">
                                  {item.subtitle}
                                </span>
                              </span>
                              {item.moduleKey && (
                                <span
                                  className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase"
                                  style={{
                                    borderColor: `${color}40`,
                                    backgroundColor: `${color}10`,
                                    color,
                                  }}
                                >
                                  {item.moduleKey}
                                </span>
                              )}
                              {typeof item.meta?.severity === 'string' && (
                                <span
                                  className={cn(
                                    'shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase',
                                    item.meta.severity === 'risk'
                                      ? 'bg-risk/10 text-risk'
                                      : item.meta.severity === 'warn'
                                        ? 'bg-warn/10 text-warn'
                                        : 'bg-info/10 text-info',
                                  )}
                                >
                                  {String(item.meta.severity)}
                                </span>
                              )}
                              <span className="shrink-0 font-mono text-[10px] text-text-muted/0 transition-colors group-aria-selected:text-text-muted">
                                ↵
                              </span>
                            </CommandPrimitive.Item>
                          );
                        })}
                      </CommandPrimitive.Group>
                    );
                  })
                )}
              </CommandPrimitive.List>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border-hairline px-4 py-2">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[10.5px] text-text-muted">
                    <kbd className="rounded border border-border-hairline bg-bg-inset px-1 py-px font-mono text-[9px]">↑</kbd>
                    <kbd className="rounded border border-border-hairline bg-bg-inset px-1 py-px font-mono text-[9px]">↓</kbd>
                    navigate
                  </span>
                  <span className="flex items-center gap-1 text-[10.5px] text-text-muted">
                    <kbd className="rounded border border-border-hairline bg-bg-inset px-1 py-px font-mono text-[9px]">↵</kbd>
                    open
                  </span>
                </div>
                {searchQuery.data && (
                  <span className="font-mono text-[10.5px] text-text-muted">
                    {searchQuery.data.total} result{searchQuery.data.total !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </CommandPrimitive>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── keyboard hook ───────────────────────────────────────────── */

/**
 * Hook that manages ⌘K / Ctrl+K toggle. Drop into AppShell.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return { open, setOpen } as const;
}
