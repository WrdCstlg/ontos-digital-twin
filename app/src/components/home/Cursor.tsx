import { memo, useEffect, useState } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion';

/**
 * Custom dot-cursor — landing page only. 12px iris dot + 36px trailing ring
 * (lerp 0.12). Over interactive elements the ring tightens to 20px and fills
 * with 10% iris.
 */
function CursorImpl() {
  const dotX = useMotionValue(-100);
  const dotY = useMotionValue(-100);
  const ringX = useMotionValue(-100);
  const ringY = useMotionValue(-100);
  const [hot, setHot] = useState(false);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      dotX.set(e.clientX);
      dotY.set(e.clientY);
      const t = e.target as HTMLElement | null;
      setHot(!!t?.closest('a, button, [role="button"]'));
    };
    window.addEventListener('mousemove', move, { passive: true });
    return () => window.removeEventListener('mousemove', move);
  }, [dotX, dotY]);

  useAnimationFrame(() => {
    ringX.set(ringX.get() + (dotX.get() - ringX.get()) * 0.12);
    ringY.set(ringY.get() + (dotY.get() - ringY.get()) * 0.12);
  });

  return (
    <>
      <motion.span
        className="pointer-events-none fixed left-0 top-0 z-[100] size-3 rounded-full bg-iris"
        style={{ x: dotX, y: dotY, translateX: '-50%', translateY: '-50%' }}
        aria-hidden
      />
      <motion.span
        className="pointer-events-none fixed left-0 top-0 z-[100] rounded-full border border-iris/60"
        style={{ x: ringX, y: ringY, translateX: '-50%', translateY: '-50%' }}
        animate={{
          width: hot ? 20 : 36,
          height: hot ? 20 : 36,
          backgroundColor: hot ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0)',
        }}
        transition={{ duration: 0.12 }}
        aria-hidden
      />
    </>
  );
}

const Cursor = memo(CursorImpl);

export function LandingCursor() {
  const [enabled, setEnabled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)');
    const onChange = (e: MediaQueryListEvent) => setEnabled(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  if (!enabled) return null;
  return <Cursor />;
}

export default LandingCursor;
