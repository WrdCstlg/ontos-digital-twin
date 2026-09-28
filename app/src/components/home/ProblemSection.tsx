import { useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useMediaQuery, usePrefersReducedMotion } from '@/components/home/motion';

const SILOS = [
  {
    name: 'HRIS · people.csv',
    color: '#FB7185',
    rows: ['emp_id,name,manager_id,dept', 'E-1042,"A. Osei",E-1001,ENG', 'E-1043,"L. Marsh",E-1001,ENG'],
  },
  {
    name: 'CLM · contracts_db',
    color: '#A78BFA',
    rows: ['contract_id,party,signed_by,value', 'C-2291,"VendorCo",E-1042,84000', 'C-2292,"DataDyne",E-1017,31200'],
  },
  {
    name: 'GRC · controls.xlsx',
    color: '#34D399',
    rows: ['control_id,framework,owner,evidence', 'SOX-IT-04,SOX,E-1001,MISSING', 'GDPR-A30,GDPR,E-1055,2025-09'],
  },
];

/** The scroll timeline, in its own units: where each step starts and ends (0 to END). */
const END = 1.05;
const at = (from: number, to: number) => [from / END, to / END];

/** A value that runs from `a` to `b` over [from, to] of the timeline, or holds `b` when nothing moves. */
function useStep<T extends number | string>(p: MotionValue<number>, from: number, to: number, a: T, b: T, moving: boolean) {
  const v = useTransform(p, at(from, to), [a, b] as T[]);
  return moving ? v : b;
}

/**
 * Problem section — sticky copy left; right shows three silo cards that
 * scatter, then get connected by self-drawing iris edges on scroll. On a wide
 * screen the stage holds still while the page scrolls 140% of the viewport
 * past it, and the timeline follows the scroll; on a narrow one, or with
 * reduced motion, the connected cluster is shown as it ends.
 */
export function ProblemSection() {
  const track = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery('(min-width: 1024px)');
  const reduced = usePrefersReducedMotion();
  const moving = wide && !reduced;

  const { scrollYProgress: p } = useScroll({ target: track, offset: ['start 20%', 'end end'] });
  // Walls dissolve, edges draw themselves (the second 0.12 later), their labels appear.
  const wallOpacity = useStep(p, 0.3, 0.65, 1, 0, moving);
  const wallBlur = useStep(p, 0.3, 0.65, 'blur(0px)', 'blur(6px)', moving);
  const edge1 = useStep(p, 0.32, 0.77, 320, 0, moving);
  const edge2 = useStep(p, 0.44, 0.89, 320, 0, moving);
  const labelOpacity = useStep(p, 0.55, 0.75, 0, 1, moving);
  // The connected cluster lifts and glows, and the caption appears.
  const stackY = useStep(p, 0.7, 1.0, 0, -20, moving);
  const stackScale = useStep(p, 0.7, 1.0, 1, 1.02, moving);
  const glow = useStep(p, 0.7, 1.0, '0px 0px 0px 0px rgba(99,102,241,0)', '0px 0px 44px -12px rgba(99,102,241,0.35)', moving);
  const captionOpacity = useStep(p, 0.8, END, 0, 1, moving);
  const captionY = useStep(p, 0.8, END, 12, 0, moving);

  return (
    <section className="relative mx-auto max-w-[1200px] px-6 py-28">
      <div className="grid gap-14 lg:grid-cols-[40%_1fr]">
        {/* Sticky copy */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">The Problem</p>
          <h2 className="mt-4 font-display text-[36px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[46px]">
            Silos store data. None of them know the business.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-text-secondary">
            Your HRIS knows people. Your CLM knows contracts. Your ERP knows spend. Nothing in your stack knows that{' '}
            <em className="text-text-primary">this person signed that contract which violates this control</em> — until
            Ontos.
          </p>
        </div>

        {/* Animated silo cards: the track is the scroll the stage holds still through */}
        <div ref={track} className={moving ? 'relative pb-[140vh]' : 'relative'}>
          <div className={moving ? 'sticky top-[20vh]' : undefined}>
            <motion.div className="relative space-y-6" style={{ y: stackY, scale: stackScale }}>
              {/* dashed silo walls */}
              <motion.div
                className="pointer-events-none absolute -left-4 top-0 h-full w-px"
                style={{
                  backgroundImage: 'repeating-linear-gradient(to bottom, #334155 0 6px, transparent 6px 12px)',
                  opacity: wallOpacity,
                  filter: wallBlur,
                }}
                aria-hidden
              />
              {SILOS.map((s, i) => (
                <motion.div
                  key={s.name}
                  className="relative rounded-xl border border-border-hairline bg-bg-panel p-5"
                  style={{ rotate: i === 1 ? 1.6 : -1.6, boxShadow: glow }}
                >
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="font-mono text-[12px] font-medium" style={{ color: s.color }}>
                      {s.name}
                    </span>
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-bg-inset p-3 font-mono text-[11.5px] leading-relaxed text-text-secondary">
                    {s.rows.join('\n')}
                  </pre>
                </motion.div>
              ))}

              {/* iris edges drawing between cards */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <motion.path
                  d="M 30 120 C -30 190, -30 260, 30 330"
                  fill="none"
                  stroke="#818CF8"
                  strokeWidth="1.5"
                  strokeDasharray="320"
                  style={{ strokeDashoffset: edge1 }}
                />
                <motion.path
                  d="M 30 330 C -30 400, -30 470, 30 540"
                  fill="none"
                  stroke="#818CF8"
                  strokeWidth="1.5"
                  strokeDasharray="320"
                  style={{ strokeDashoffset: edge2 }}
                />
              </svg>
              <motion.div
                className="pointer-events-none absolute -left-2 top-[200px] -rotate-90 font-mono text-[10px] text-iris-bright"
                style={{ opacity: labelOpacity }}
              >
                hr:Person —signs→ legal:Contract
              </motion.div>
              <motion.div
                className="pointer-events-none absolute -left-2 top-[430px] -rotate-90 font-mono text-[10px] text-iris-bright"
                style={{ opacity: labelOpacity }}
              >
                cmp:Control —monitors→ fin:Transaction
              </motion.div>
            </motion.div>
            <motion.p
              className="mt-8 text-center font-mono text-[12px] uppercase tracking-[0.12em] text-iris-bright"
              style={{ opacity: captionOpacity, y: captionY }}
            >
              One graph. Every function.
            </motion.p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProblemSection;
