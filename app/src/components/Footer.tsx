import { Link } from 'react-router';
import { StatusDot } from '@/components/ui/status-dot';

const PRODUCT_LINKS = [
  { label: 'Platform', href: '/#platform' },
  { label: 'Modules', href: '/#modules' },
  { label: 'Explorer', href: '/#explorer' },
  { label: 'Insights', href: '/#insights' },
  { label: 'Architecture', href: '/#architecture' },
];

const RESOURCE_LINKS = [
  { label: 'Modeling Guides', href: '/app/library' },
  { label: 'API Docs', href: '/app/decisions' },
  { label: 'Decisions', href: '/app/decisions' },
  { label: 'Audit', href: '/app/admin' },
];

const STATUS_PILLS = ['Graph Store', 'Sync Engine', 'Reasoner', 'LLM'];

/** Landing footer — 4 columns + status pills + copyright bar. */
export function Footer() {
  return (
    <footer className="border-t border-border-hairline bg-bg-base">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="" className="size-6" />
              <span className="font-display text-[16px] font-semibold text-text-primary">ontos</span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
              The semantic layer of the enterprise.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">Product</h4>
            <ul className="mt-3 space-y-2">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-[13px] text-text-secondary transition-colors hover:text-text-primary">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">Resources</h4>
            <ul className="mt-3 space-y-2">
              {RESOURCE_LINKS.map((l) => (
                <li key={l.label}>
                  <Link to={l.href} className="text-[13px] text-text-secondary transition-colors hover:text-text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* System status */}
          <div>
            <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">System Status</h4>
            <ul className="mt-3 space-y-2">
              {STATUS_PILLS.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <StatusDot status="ok" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-border-hairline pt-6 sm:flex-row sm:items-center">
          <span className="text-[13px] text-text-muted">© 2025 Ontos Systems</span>
          <span className="font-mono text-[11.5px] text-text-muted">
            Demo build — fictional Acme Corp data
          </span>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
