import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

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

/**
 * Problem section — sticky copy left; right shows three silo cards that
 * scatter, then get connected by self-drawing iris edges on scroll.
 */
export function ProblemSection() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', () => {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: '.problem-stage',
            start: 'top 20%',
            end: '+=140%',
            scrub: 0.6,
            pin: true,
          },
        });
        // Phase 2: walls dissolve, edges draw themselves
        tl.to('.silo-wall', { opacity: 0, filter: 'blur(6px)', duration: 0.35 }, 0.3)
          .fromTo(
            '.silo-edge path',
            { strokeDashoffset: 320 },
            { strokeDashoffset: 0, duration: 0.45, stagger: 0.12, ease: 'none' },
            0.32,
          )
          .fromTo('.silo-edge-label', { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.55)
          // Phase 3: connected cluster lifts + glows, caption appears
          .to('.silo-stack', { y: -20, scale: 1.02, duration: 0.3, ease: 'power2.out' }, 0.7)
          .to('.silo-card', { boxShadow: '0 0 44px -12px rgba(99,102,241,0.35)', duration: 0.3 }, 0.7)
          .fromTo('.silo-caption', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25 }, 0.8);
        return () => {
          tl.scrollTrigger?.kill();
          tl.kill();
        };
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative mx-auto max-w-[1200px] px-6 py-28">
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

        {/* Animated silo cards */}
        <div className="problem-stage relative">
          <div className="silo-stack relative space-y-6">
            {/* dashed silo walls */}
            <div
              className="silo-wall pointer-events-none absolute -left-4 top-0 h-full w-px"
              style={{
                backgroundImage: 'repeating-linear-gradient(to bottom, #334155 0 6px, transparent 6px 12px)',
              }}
              aria-hidden
            />
            {SILOS.map((s, i) => (
              <div
                key={s.name}
                className="silo-card relative rounded-xl border border-border-hairline bg-bg-panel p-5"
                style={{
                  transform: `rotate(${i === 1 ? 1.6 : -1.6}deg)`,
                  boxShadow: '0 0 0 0 rgba(0,0,0,0)',
                }}
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
              </div>
            ))}

            {/* iris edges drawing between cards */}
            <svg className="silo-edge pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              <path
                d="M 30 120 C -30 190, -30 260, 30 330"
                fill="none"
                stroke="#818CF8"
                strokeWidth="1.5"
                strokeDasharray="320"
                strokeDashoffset="320"
              />
              <path
                d="M 30 330 C -30 400, -30 470, 30 540"
                fill="none"
                stroke="#818CF8"
                strokeWidth="1.5"
                strokeDasharray="320"
                strokeDashoffset="320"
              />
            </svg>
            <div className="silo-edge-label pointer-events-none absolute -left-2 top-[200px] -rotate-90 font-mono text-[10px] text-iris-bright opacity-0">
              hr:Person —signs→ legal:Contract
            </div>
            <div className="silo-edge-label pointer-events-none absolute -left-2 top-[430px] -rotate-90 font-mono text-[10px] text-iris-bright opacity-0">
              cmp:Control —monitors→ fin:Transaction
            </div>
          </div>
          <p className="silo-caption mt-8 text-center font-mono text-[12px] uppercase tracking-[0.12em] text-iris-bright opacity-0">
            One graph. Every function.
          </p>
        </div>
      </div>
    </section>
  );
}

export default ProblemSection;
