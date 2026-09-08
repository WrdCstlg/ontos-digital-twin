import { Suspense, lazy, useRef, useState } from 'react';
import { Link } from 'react-router';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

const HeroGraph = lazy(() => import('@/components/home/HeroGraph'));

function usePrefersReducedMotion() {
  const [reduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return reduced;
}

/**
 * Hero — "The Living Graph". Full-viewport R3F constellation behind a
 * centered content column; GSAP SplitText headline entrance; scroll-driven
 * scale/fade (hero is pinned by the page for 160vh equivalent).
 */
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();

  useGSAP(
    () => {
      if (reduced) return;

      // H1 word-level split entrance
      const split = new SplitText('.hero-h1 .line', { type: 'words' });
      gsap.from(split.words, {
        y: 40,
        rotation: 2,
        opacity: 0,
        duration: 0.9,
        stagger: 0.07,
        ease: 'expo.out',
        delay: 0.3,
      });
      gsap.from('.hero-rise', {
        y: 24,
        opacity: 0,
        duration: 0.8,
        stagger: 0.12,
        ease: 'expo.out',
        delay: 1.0,
      });

      // Scroll-driven: content scales/fades as the hero scrolls away
      gsap.to('.hero-content', {
        scale: 0.92,
        opacity: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom 35%',
          scrub: true,
        },
      });
      gsap.to('.hero-scroll-hint', {
        opacity: 0,
        scrollTrigger: { trigger: root.current, start: 'top top', end: '+=120', scrub: true },
      });

      return () => split.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative -mt-16 flex min-h-[100dvh] items-center justify-center overflow-hidden bg-bg-void">
      {/* 3D constellation (or static fallback for reduced motion) */}
      {reduced ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 60% 50% at 30% 20%, rgba(99,102,241,0.2), transparent), url(/hero-node-texture.svg)',
            backgroundSize: 'cover',
          }}
        />
      ) : (
        <Suspense
          fallback={
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'radial-gradient(ellipse 60% 50% at 30% 20%, rgba(99,102,241,0.2), transparent), url(/hero-node-texture.svg)',
                backgroundSize: 'cover',
              }}
            />
          }
        >
          <HeroGraph />
        </Suspense>
      )}
      {/* vignette to keep copy legible */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_55%,rgba(7,11,20,0.72),transparent_75%)]" />

      {/* Content */}
      <div className="hero-content relative z-10 mx-auto flex max-w-[840px] flex-col items-center px-6 pb-28 pt-32 text-center">
        <p className="hero-rise text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">
          Business-Function Ontology Platform · v1.0
        </p>
        <h1 className="hero-h1 mt-6 font-display text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-[60px] lg:text-[72px]">
          <span className="line block">Your enterprise already has the data.</span>
          <span className="line block text-gradient-iris">Ontos gives it meaning.</span>
        </h1>
        <p className="hero-rise mt-6 max-w-[560px] text-[17px] leading-relaxed text-text-secondary">
          Model HR, Legal, Compliance, Finance, and Logistics as versioned ontologies. Map real data onto them.
          Watch a living knowledge graph surface the risks, gaps, and redundancies your silos were hiding.
        </p>
        <div className="hero-rise mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/app"
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-iris-deep to-iris px-6 py-3 text-[15px] font-medium text-white shadow-[0_0_32px_-8px_rgba(99,102,241,0.6)] transition-transform duration-150 hover:scale-[1.02]"
          >
            Launch the Acme Demo
            <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-1" />
          </Link>
          <a
            href="#architecture"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-flex items-center rounded-xl border border-border-hairline bg-bg-panel/40 px-6 py-3 text-[15px] text-text-secondary backdrop-blur transition-colors duration-150 hover:border-border-glow hover:text-text-primary"
          >
            Explore the architecture
          </a>
        </div>

        {/* Stat strip */}
        <div className="hero-rise mt-16 flex items-stretch gap-0 rounded-xl border border-border-hairline bg-bg-panel/40 backdrop-blur">
          {[
            ['5', 'ontology modules'],
            ['10M+', 'edge scale target'],
            ['100%', 'traceable insights'],
          ].map(([v, l], i) => (
            <div key={l} className="flex items-center">
              {i > 0 && <span className="h-8 w-px bg-border-hairline" />}
              <div className="px-6 py-3.5">
                <div className="font-mono text-[18px] font-medium tabular-nums text-text-primary">{v}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-[0.06em] text-text-muted">{l}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="hero-scroll-hint absolute bottom-6 left-1/2 z-10 -translate-x-1/2" aria-hidden>
        <div className="relative h-12 w-px overflow-hidden bg-border-hairline">
          <span className="absolute left-0 top-0 h-2 w-px animate-[scrolldot_1.8s_ease-in-out_infinite] bg-iris-bright" />
        </div>
      </div>
      <style>{`@keyframes scrolldot { 0% { transform: translateY(-8px); opacity: 0 } 30% { opacity: 1 } 100% { transform: translateY(48px); opacity: 0 } }`}</style>
    </section>
  );
}

export default Hero;
