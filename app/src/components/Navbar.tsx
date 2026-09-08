import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { LOGIN_PATH } from '@/const';

const NAV_LINKS = [
  { label: 'Platform', href: '/#platform' },
  { label: 'Modules', href: '/#modules' },
  { label: 'Explorer', href: '/#explorer' },
  { label: 'Insights', href: '/#insights' },
  { label: 'Architecture', href: '/#architecture' },
];

/**
 * Marketing nav — landing only. Fixed 64px, blur backdrop, hairline border
 * appears on scroll >40px. Content offset is owned by Layout.
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

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (href: string) => (e: React.MouseEvent) => {
    if (!href.startsWith('/#')) return;
    e.preventDefault();
    document.getElementById(href.slice(2))?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 h-16 transition-all duration-300',
        scrolled
          ? 'border-b border-border-hairline bg-bg-void/70 backdrop-blur-md'
          : 'border-b border-transparent bg-bg-void/0',
      )}
    >
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5" aria-label="Ontos home">
          <img src="/logo.svg" alt="" className="size-7" />
          <span className="font-display text-[18px] font-semibold tracking-tight text-text-primary">ontos</span>
        </Link>

        {/* Center links */}
        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              onClick={scrollTo(l.href)}
              className="group relative text-[14px] text-text-secondary transition-colors duration-150 hover:text-text-primary"
            >
              {l.label}
              <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-iris transition-all duration-200 ease-out group-hover:w-full" />
            </a>
          ))}
        </nav>

        {/* Account area */}
        <div className="flex items-center gap-3">
          {/* AUTH-SLOT: wired to useAuth() */}
          {isLoading ? (
            <span
              aria-hidden
              className="h-[30px] w-[72px] animate-pulse rounded-lg border border-border-hairline bg-bg-panel"
            />
          ) : isAuthenticated && user ? (
            <span className="flex items-center gap-2.5">
              {user.avatar ? (
                <img src={user.avatar} alt="" className="size-7 rounded-full border border-border-hairline" />
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-iris-deep to-iris font-display text-[10.5px] font-semibold text-white">
                  {initials(user.name)}
                </span>
              )}
              <span className="hidden max-w-[140px] truncate text-[14px] text-text-primary sm:inline">
                {user.name ?? 'Signed in'}
              </span>
              <button
                type="button"
                onClick={() => logout()}
                aria-label="Sign out"
                title="Sign out"
                className="rounded-lg border border-border-hairline p-1.5 text-text-secondary transition-colors duration-150 hover:border-border-glow hover:text-text-primary"
              >
                <LogOut className="size-4" />
              </button>
            </span>
          ) : (
            <Link
              to={LOGIN_PATH}
              className="rounded-lg border border-border-hairline px-3.5 py-1.5 text-[14px] text-text-secondary transition-colors duration-150 hover:border-border-glow hover:text-text-primary"
            >
              Sign in
            </Link>
          )}
          <Link
            to="/app"
            className="group inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-1.5 text-[14px] font-medium text-white transition-transform duration-150 hover:scale-[1.02]"
          >
            Launch Demo
            <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </motion.header>
  );
}

export default Navbar;
