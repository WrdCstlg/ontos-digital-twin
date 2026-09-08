import { useEffect } from 'react';
import Lenis from 'lenis';
import Hero from '@/components/home/Hero';
import ProblemSection from '@/components/home/ProblemSection';
import Pillars from '@/components/home/Pillars';
import ModuleShowcase from '@/components/home/ModuleShowcase';
import TerminalDemo from '@/components/home/TerminalDemo';
import InsightsTeaser from '@/components/home/InsightsTeaser';
import ArchTeaser from '@/components/home/ArchTeaser';
import FinalCTA from '@/components/home/FinalCTA';
import LandingCursor from '@/components/home/Cursor';

/**
 * Landing page — cinematic marketing page for Ontos.
 * Lenis smooth scroll; GSAP pinned scenes (Hero, Problem) are isolated from
 * the Framer Motion UI sections.
 */
export default function Home() {
  useEffect(() => {
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return (
    <div className="bg-bg-void">
      <LandingCursor />
      <Hero />
      <ProblemSection />
      <Pillars />
      <ModuleShowcase />
      <TerminalDemo />
      <InsightsTeaser />
      <ArchTeaser />
      <FinalCTA />
    </div>
  );
}
