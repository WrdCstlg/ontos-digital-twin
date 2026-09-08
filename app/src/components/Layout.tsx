import type { ReactNode } from 'react';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

/**
 * Marketing shell — wraps the landing page. The nav is fixed 64px, so the
 * content slot carries matching top padding; full-bleed hero sections opt
 * out inside the page with `-mt-16`.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-bg-void text-text-primary">
      <Navbar />
      <main className="pt-16">{children}</main>
      <Footer />
    </div>
  );
}

export default Layout;
