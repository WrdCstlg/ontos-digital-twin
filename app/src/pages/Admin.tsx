import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, Download, ScrollText, ShieldCheck, Sparkles } from 'lucide-react';
import { useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { WorkspacesSection } from '@/components/admin/WorkspacesSection';
import { RbacSection } from '@/components/admin/RbacSection';
import { ProvidersSection } from '@/components/admin/ProvidersSection';
import { AuditSection } from '@/components/admin/AuditSection';

type SectionKey = 'workspaces' | 'rbac' | 'llm' | 'audit';

const SECTIONS: { key: SectionKey; label: string; icon: typeof Building2 }[] = [
  { key: 'workspaces', label: 'Workspaces', icon: Building2 },
  { key: 'rbac', label: 'Roles & Access', icon: ShieldCheck },
  { key: 'llm', label: 'LLM Providers', icon: Sparkles },
  { key: 'audit', label: 'Audit Log', icon: ScrollText },
];

function sectionFromHash(hash: string): SectionKey {
  const h = hash.replace('#', '');
  return (SECTIONS.find((s) => s.key === h)?.key ?? 'workspaces') as SectionKey;
}

export default function Admin() {
  const location = useLocation();
  // Local override wins; a router-driven hash change clears it (adjust-during-render).
  const [chosen, setChosen] = useState<SectionKey | null>(null);
  const [lastHash, setLastHash] = useState(location.hash);
  if (lastHash !== location.hash) {
    setLastHash(location.hash);
    setChosen(null);
  }
  const section = chosen ?? sectionFromHash(location.hash);

  const select = (key: SectionKey) => {
    setChosen(key);
    window.history.replaceState(null, '', `#${key}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 py-8 lg:px-8">
      <Toaster position="bottom-right" theme="dark" />

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
            Administration
          </h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            Tenancy, access, providers, and the audit trail — every change recorded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border-hairline bg-bg-inset px-2.5 py-1 font-mono text-[10.5px] text-text-muted">
            env: evaluation · docker-compose
          </span>
          <button
            type="button"
            onClick={() => {
              select('audit');
              requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('ontos:export-audit')));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3.5 py-2 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <Download className="size-3.5" /> Export audit log (CSV)
          </button>
        </div>
      </motion.header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Sub-nav rail */}
        <nav className="hidden lg:block" aria-label="Admin sections">
          <div className="sticky top-20 space-y-1">
            {SECTIONS.map((s) => {
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => select(s.key)}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition-colors duration-150',
                    active
                      ? 'bg-bg-panel-raised text-text-accent'
                      : 'text-text-secondary hover:bg-bg-panel-raised/60 hover:text-text-primary',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="admin-nav-indicator"
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-iris"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}
                  <s.icon className="size-4 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Mobile section switcher */}
        <div className="flex gap-1.5 overflow-x-auto lg:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => select(s.key)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                section === s.key
                  ? 'border-iris/50 bg-iris/15 text-text-accent'
                  : 'border-border-hairline text-text-muted',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Content — sections switch in place with a 200ms cross-fade */}
        <div className="min-w-0 max-w-[1000px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <span id={section} className="block scroll-mt-20" aria-hidden />
              {section === 'workspaces' && <WorkspacesSection />}
              {section === 'rbac' && <RbacSection />}
              {section === 'llm' && <ProvidersSection />}
              {section === 'audit' && <AuditSection />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
