import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  Bell,
  BookCopy,
  ChevronDown,
  DatabaseZap,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  ScanHeart,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Split,
  Waypoints,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/status-dot';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/app', icon: LayoutDashboard, end: true },
      { label: 'Insights', to: '/app/insights', icon: Sparkles },
    ],
  },
  {
    title: 'Model',
    items: [
      { label: 'Module Library', to: '/app/library', icon: BookCopy },
      { label: 'Ontology Studio', to: '/app/studio', icon: PencilRuler },
    ],
  },
  {
    title: 'Data',
    items: [
      { label: 'Mapping & Sync', to: '/app/mapping', icon: DatabaseZap },
      { label: 'Graph Explorer', to: '/app/explorer', icon: Waypoints },
      { label: 'Twin Explorer', to: '/app/twins', icon: ScanHeart },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Audit Log', to: '/app/admin#audit', icon: ScrollText },
      { label: 'Admin', to: '/app/admin', icon: ShieldCheck, end: true },
      { label: 'Decisions & Architecture', to: '/app/decisions', icon: Split },
    ],
  },
];

const CRUMB_NAMES: Record<string, string> = {
  library: 'Module Library',
  studio: 'Ontology Studio',
  mapping: 'Mapping & Sync',
  explorer: 'Graph Explorer',
  twins: 'Twin Explorer',
  insights: 'Insights',
  decisions: 'Decisions & Architecture',
  admin: 'Admin',
};

/**
 * AppShell — all app pages. Fixed left sidebar (240px, collapsible to 64px)
 * with sectioned nav, LLM status pill and user card at the bottom; 56px
 * sticky top bar with breadcrumb, ⌘K search, sync status, notifications and
 * tenant badge. Page content renders via <Outlet/>.
 */
function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const seg = location.pathname.split('/').filter(Boolean)[1];
  const crumb = seg ? (CRUMB_NAMES[seg] ?? seg) : 'Dashboard';

  return (
    <div className="flex min-h-[100dvh] bg-bg-base text-text-primary">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border-hairline bg-bg-panel transition-[width] duration-200 ease-out-expo',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Wordmark + workspace switcher */}
        <div className={cn('flex h-16 items-center border-b border-border-hairline', collapsed ? 'justify-center px-2' : 'px-4')}>
          {collapsed ? (
            <Link to="/app" aria-label="Ontos dashboard">
              <img src="/logo.svg" alt="" className="size-7" />
            </Link>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-bg-panel-raised"
            >
              <img src="/logo.svg" alt="" className="size-7 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text-primary">Acme Corp — Production</span>
                <span className="block truncate font-mono text-[10.5px] text-text-muted">workspace · acme-prod</span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-text-muted" />
            </button>
          )}
        </div>

        {/* Nav sections */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="App navigation">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              {!collapsed && (
                <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {section.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const [path, hash] = item.to.split('#');
                  return (
                    <li key={item.label}>
                      <NavLink
                        to={path}
                        end={item.end}
                        onClick={() => {
                          if (hash) {
                            requestAnimationFrame(() =>
                              document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }),
                            );
                          }
                        }}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px] transition-colors duration-150',
                            collapsed && 'justify-center px-0',
                            isActive
                              ? 'bg-bg-panel-raised text-text-accent'
                              : 'text-text-secondary hover:bg-bg-panel-raised/60 hover:text-text-primary',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute left-[-12px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-iris" />
                            )}
                            <item.icon className="size-4 shrink-0" />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Bottom: LLM status + user card + collapse toggle */}
        <div className="space-y-2 border-t border-border-hairline p-3">
          {!collapsed && (
            <div className="flex items-center gap-2 rounded-full border border-border-hairline bg-bg-inset px-2.5 py-1.5">
              <StatusDot status="ok" />
              <span className="truncate font-mono text-[10.5px] text-text-secondary">Ollama · llama3.1 · local</span>
            </div>
          )}
          <div className={cn('flex items-center gap-2.5 rounded-lg p-1.5', !collapsed && 'hover:bg-bg-panel-raised')}>
            {isLoading ? (
              <span aria-hidden className="size-8 shrink-0 animate-pulse rounded-full border border-border-hairline bg-bg-panel-raised" />
            ) : isAuthenticated && user?.avatar ? (
              <img src={user.avatar} alt="" className="size-8 shrink-0 rounded-full border border-border-hairline" />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-iris-deep to-iris font-display text-[12px] font-semibold text-white">
                {isAuthenticated ? initials(user?.name) : 'GV'}
              </span>
            )}
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text-primary">
                  {isLoading ? '…' : isAuthenticated ? (user?.name ?? 'Signed in') : 'Guest viewer'}
                </span>
                <span className="mt-0.5 inline-block rounded-full border border-iris/30 bg-iris/15 px-1.5 py-0 text-[9.5px] font-medium uppercase tracking-[0.08em] text-text-accent">
                  {isAuthenticated ? (user?.role === 'admin' ? 'Admin' : 'Ontologist') : 'Viewer'}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && <span className="text-[12px]">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Content column */}
      <div className={cn('flex min-w-0 flex-1 flex-col transition-[margin] duration-200 ease-out-expo', collapsed ? 'ml-16' : 'ml-60')}>
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-border-hairline bg-bg-base/85 px-6 backdrop-blur-md">
          <nav className="flex items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
            <span className="text-text-muted">Workspace</span>
            <span className="text-text-muted">/</span>
            <span className="font-medium text-text-primary">{crumb}</span>
          </nav>

          {/* ⌘K search placeholder */}
          <button
            type="button"
            className="mx-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-1.5 text-left transition-colors hover:border-border-glow"
          >
            <Search className="size-3.5 text-text-muted" />
            <span className="flex-1 truncate font-mono text-[12px] text-text-muted">
              Search classes, instances, queries…
            </span>
            <kbd className="rounded border border-border-hairline bg-bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2 font-mono text-[11px] text-text-secondary lg:flex">
              <StatusDot status="ok" />
              live · last sync 42s ago
            </span>
            <button
              type="button"
              aria-label="Notifications"
              className="relative rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
            >
              <Bell className="size-4" />
              <span className="absolute right-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-risk font-mono text-[8.5px] font-bold text-white">
                3
              </span>
            </button>
            <span className="hidden rounded-full border border-border-hairline bg-bg-panel px-2.5 py-1 font-mono text-[10.5px] text-text-secondary md:inline-block">
              acme-prod
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppShell;
