import { Suspense, lazy, useRef } from 'react';
import { Link } from 'react-router';
import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { EXPO_OUT, usePrefersReducedMotion } from '@/components/home/motion';

const HeroGraph = lazy(() => import('@/components/home/HeroGraph'));

const HEADLINE = ['Your enterprise already has the data.', 'Ontos gives it meaning.'];

/**
 * Hero — "The Living Graph". Full-viewport R3F constellation behind a
 * centered content column; a word-by-word headline entrance; scroll-driven
 * scale/fade as the hero leaves. With reduced motion, everything is still.
 */
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();

  // The content scales and fades as the hero scrolls away, and the scroll
  // hint fades over the first 120 px.
  const { scrollYProgress } = useScroll({ target: root, offset: ['start start', 'end 35%'] });
  const { scrollY } = useScroll();
  const contentScale = useTransform(scrollYProgress, [0, 1], [1, 0.92]);
  const contentOpacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  const hintOpacity = useTransform(scrollY, [0, 120], [1, 0]);

  // Rise in after the headline: each element staggered by 0.12 s.
  let rise = 0;
  const riseIn = () => {
    const i = rise++;
    return reduced
      ? {}
      : {
          initial: { y: 24, opacity: 0 },
          animate: { y: 0, opacity: 1 },
          transition: { duration: 0.8, delay: 1.0 + i * 0.12, ease: EXPO_OUT },
        };
  };
  let word = 0;

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
      <motion.div
        className="relative z-10 mx-auto flex max-w-[840px] flex-col items-center px-6 pb-28 pt-32 text-center"
        style={reduced ? undefined : { scale: contentScale, opacity: contentOpacity }}
      >
        <motion.p {...riseIn()} className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">
          Business-Function Ontology Platform · v1.0
        </motion.p>
        <h1
          className="mt-6 font-display text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-[60px] lg:text-[72px]"
          aria-label={HEADLINE.join(' ')}
        >
          {HEADLINE.map((line, li) => (
            <span key={line} className={li === 1 ? 'block text-gradient-iris' : 'block'} aria-hidden>
              {line.split(' ').map((w, wi, words) => {
                const i = word++;
                return (
                  <span key={wi}>
                    <motion.span
                      className="inline-block"
                      {...(reduced
                        ? {}
                        : {
                            initial: { y: 40, rotate: 2, opacity: 0 },
                            animate: { y: 0, rotate: 0, opacity: 1 },
                            transition: { duration: 0.9, delay: 0.3 + i * 0.07, ease: EXPO_OUT },
                          })}
                    >
                      {w}
                    </motion.span>
                    {wi < words.length - 1 ? ' ' : null}
                  </span>
                );
              })}
            </span>
          ))}
        </h1>
        <motion.p {...riseIn()} className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-text-secondary">
          Model HR, Legal, Compliance, Finance, and Logistics as versioned ontologies. Map real data onto them.
          Watch a living knowledge graph surface the risks, gaps, and redundancies your silos were hiding.
        </motion.p>
        <motion.div {...riseIn()} className="mt-9 flex flex-wrap items-center justify-center gap-4">
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
        </motion.div>

        {/* Stat strip */}
        <motion.div
          {...riseIn()}
          className="mt-16 flex items-stretch gap-0 rounded-xl border border-border-hairline bg-bg-panel/40 backdrop-blur"
        >
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
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2"
        style={reduced ? undefined : { opacity: hintOpacity }}
        aria-hidden
      >
        <div className="relative h-12 w-px overflow-hidden bg-border-hairline">
          <span className="absolute left-0 top-0 h-2 w-px animate-[scrolldot_1.8s_ease-in-out_infinite] bg-iris-bright" />
        </div>
      </motion.div>
      <style>{`@keyframes scrolldot { 0% { transform: translateY(-8px); opacity: 0 } 30% { opacity: 1 } 100% { transform: translateY(48px); opacity: 0 } }`}</style>
    </section>
  );
}

export default Hero;
