import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  Bell,
  BookCopy,
  ChevronDown,
  Compass,
  DatabaseZap,
  LayoutDashboard,
  MapIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PencilRuler,
  ScanHeart,
  ScrollText,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Split,
  Waypoints,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot, type StatusKind } from '@/components/ui/status-dot';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNow } from '@/hooks/useNow';

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  requiredRole?: string;
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
      { label: 'Field Guide', to: '/app/guide', icon: Compass },
      { label: 'Landscape', to: '/app/landscape', icon: MapIcon },
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
      { label: 'Operations', to: '/app/operations', icon: ServerCog },
      { label: 'Actions', to: '/app/actions', icon: Zap },
      { label: 'Audit Log', to: '/app/admin#audit', icon: ScrollText },
      { label: 'Admin', to: '/app/admin', icon: ShieldCheck, end: true, requiredRole: 'admin' },
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
  guide: 'Field Guide',
  operations: 'Operations',
  actions: 'Actions',
  landscape: 'Landscape',
};

function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** "42s ago", "3 min ago", "2 h ago", "4 d ago". */
function sinceLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const STATUS_POLL_MS = 30_000;

/**
 * Top-bar status: whether a worker is serving the queue (operations.summary)
 * and when the last import finished (mapping.listSyncJobs). Shows "live" only
 * once a worker has been observed; neutral while loading or on error.
 */
function ShellStatus() {
  const now = useNow(STATUS_POLL_MS);
  const summary = trpc.operations.summary.useQuery(undefined, {
    retry: false,
    staleTime: STATUS_POLL_MS / 2,
    refetchInterval: STATUS_POLL_MS,
  });
  const syncs = trpc.mapping.listSyncJobs.useQuery(
    { limit: 10 },
    { retry: false, staleTime: STATUS_POLL_MS / 2, refetchInterval: STATUS_POLL_MS },
  );

  let dot: StatusKind = 'idle';
  let word = summary.isError ? 'status unavailable' : 'checking…';
  if (summary.data) {
    if (summary.data.workersAlive > 0) {
      dot = 'ok';
      word = 'live';
    } else {
      dot = 'warn';
      word = 'no worker';
    }
  }

  let lastSync: string | null = null;
  if (syncs.data) {
    const finished = syncs.data
      .map((j) => (j.finishedAt ? new Date(j.finishedAt).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    lastSync = finished.length ? `last sync ${sinceLabel((now - Math.max(...finished)) / 1000)}` : 'no syncs yet';
  }

  const title =
    dot === 'ok'
      ? `${summary.data?.workersAlive} worker${summary.data?.workersAlive === 1 ? '' : 's'} alive — open Operations`
      : dot === 'warn'
        ? 'No worker is running; queued imports will wait — open Operations'
        : 'Open Operations';

  return (
    <Link
      to="/app/operations"
      title={title}
      className={cn(
        'hidden items-center gap-2 rounded-md font-mono text-[11px] transition-colors hover:text-text-primary lg:flex',
        dot === 'warn' ? 'text-warn' : 'text-text-secondary',
      )}
    >
      <StatusDot status={dot} pulse={dot !== 'idle'} />
      {word}
      {lastSync && ` · ${lastSync}`}
    </Link>
  );
}

/**
 * AppShell — all app pages. Fixed left sidebar (240px, collapsible to 64px)
 * with sectioned nav, LLM status pill and user card at the bottom; 56px
 * sticky top bar with breadcrumb, ⌘K search, sync status, notifications and
 * tenant badge. Below the md breakpoint the sidebar becomes an overlay drawer
 * opened from the top bar, and the content takes the full width. Page content
 * renders via <Outlet/>.
 */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const seg = location.pathname.split('/').filter(Boolean)[1];
  const crumb = seg ? (CRUMB_NAMES[seg] ?? seg) : 'Dashboard';

  /* ── mobile drawer ── */
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Close on navigation and when the viewport grows past md (adjust during render).
  const [navKey, setNavKey] = useState(location.key);
  if (navKey !== location.key) {
    setNavKey(location.key);
    setDrawerOpen(false);
  }
  if (drawerOpen && !isMobile) setDrawerOpen(false);
  // The drawer always shows the full sidebar; the 64px rail is a desktop choice.
  const rail = collapsed && !drawerOpen;

  useEffect(() => {
    if (!drawerOpen) return;
    const aside = asideRef.current;
    const menuButton = menuButtonRef.current;
    const focusables = () =>
      aside
        ? [...aside.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        : [];
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (aside?.querySelector<HTMLElement>('[data-drawer-close]') ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep focus inside the drawer while it is open.
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      const inside = aside?.contains(document.activeElement) ?? false;
      if (!inside || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      menuButton?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-[100dvh] bg-bg-base text-text-primary">
      {/* Drawer backdrop (below md only) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-bg-void/70 backdrop-blur-sm animate-in fade-in-0 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — fixed rail on md+, off-canvas drawer below */}
      <aside
        ref={asideRef}
        id="app-sidebar"
        aria-label="Sidebar"
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border-hairline bg-bg-panel duration-200 ease-out-expo',
          rail ? 'w-16' : 'w-60',
          // Opening shows the drawer at once (so focus can move into it); closing
          // keeps it visible until the slide-out ends, then hides it from focus.
          drawerOpen
            ? 'translate-x-0 shadow-2xl transition-[width,transform]'
            : 'transition-[width,transform,visibility] max-md:invisible max-md:-translate-x-full',
        )}
      >
        {/* Wordmark + workspace switcher */}
        <div className={cn('flex h-16 items-center border-b border-border-hairline', rail ? 'justify-center px-2' : 'px-4')}>
          {rail ? (
            <Link to="/app" aria-label="Ontos dashboard">
              <img src="/logo.svg" alt="" className="size-7" />
            </Link>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-bg-panel-raised"
            >
              <img src="/logo.svg" alt="" className="size-7 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text-primary">Acme Corp — Production</span>
                <span className="block truncate font-mono text-[10.5px] text-text-muted">workspace · acme-prod</span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-text-muted" />
            </button>
          )}
          {drawerOpen && (
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              data-drawer-close
              className="ml-2 shrink-0 rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Nav sections */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="App navigation">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              {!rail && (
                <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {section.title}
                </div>
              )}
              <ul className="space-y-0.5">
                {section.items
                  .filter((item) => !item.requiredRole || user?.role === item.requiredRole)
                  .map((item) => {
                  const [path, hash] = item.to.split('#');
                  return (
                    <li key={item.label}>
                      <NavLink
                        to={path}
                        end={item.end}
                        onClick={() => {
                          setDrawerOpen(false);
                          if (hash) {
                            requestAnimationFrame(() =>
                              document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }),
                            );
                          }
                        }}
                        title={rail ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px] transition-colors duration-150',
                            rail && 'justify-center px-0',
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
                            {!rail && <span className="truncate">{item.label}</span>}
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
          {!rail && (
            <div className="flex items-center gap-2 rounded-full border border-border-hairline bg-bg-inset px-2.5 py-1.5">
              <StatusDot status="ok" />
              <span className="truncate font-mono text-[10.5px] text-text-secondary">Ollama · llama3.1 · local</span>
            </div>
          )}
          <div className={cn('flex items-center gap-2.5 rounded-lg p-1.5', !rail && 'hover:bg-bg-panel-raised')}>
            {isLoading ? (
              <span aria-hidden className="size-8 shrink-0 animate-pulse rounded-full border border-border-hairline bg-bg-panel-raised" />
            ) : isAuthenticated && user?.avatar ? (
              <img src={user.avatar} alt="" className="size-8 shrink-0 rounded-full border border-border-hairline" />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-iris-deep to-iris font-display text-[12px] font-semibold text-white">
                {isAuthenticated ? initials(user?.name) : 'GV'}
              </span>
            )}
            {!rail && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text-primary">
                  {isLoading ? '…' : isAuthenticated ? (user?.name ?? 'Signed in') : 'Guest viewer'}
                </span>
                <span className="mt-0.5 inline-block rounded-full border border-iris/30 bg-iris/15 px-1.5 py-0 text-[9.5px] font-medium uppercase tracking-[0.08em] text-text-accent">
                  {isAuthenticated && user?.role
                    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                    : 'Viewer'}
                </span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary max-md:hidden',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && <span className="text-[12px]">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Content column — full width below md, beside the sidebar above */}
      <div className={cn('flex min-w-0 flex-1 flex-col transition-[margin] duration-200 ease-out-expo', collapsed ? 'md:ml-16' : 'md:ml-60')}>
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border-hairline bg-bg-base/85 px-4 backdrop-blur-md md:gap-4 md:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-controls="app-sidebar"
            aria-expanded={drawerOpen}
            className="-ml-1 shrink-0 rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <nav className="flex min-w-0 items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
            <span className="hidden text-text-muted sm:inline">Workspace</span>
            <span className="hidden text-text-muted sm:inline">/</span>
            <span className="truncate font-medium text-text-primary">{crumb}</span>
          </nav>

          {/* ⌘K search placeholder */}
          <button
            type="button"
            className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-1.5 text-left transition-colors hover:border-border-glow sm:flex"
          >
            <Search className="size-3.5 text-text-muted" />
            <span className="flex-1 truncate font-mono text-[12px] text-text-muted">
              Search classes, instances, queries…
            </span>
            <kbd className="rounded border border-border-hairline bg-bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ShellStatus />
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

        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppShell;
