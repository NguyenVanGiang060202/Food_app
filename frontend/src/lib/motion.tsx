import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';

// Shared easing tokens following Emil Kowalski's animation vocabulary.
// UI entrances use strong ease-out; on-screen movement uses ease-in-out.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

// Entrance for occasional content: fade + tiny rise from `scale(0.97)` (never scale(0)) + opacity.
export const enterVariants: Variants = {
  hidden: { opacity: 0, transform: 'translateY(12px) scale(0.97)' },
  visible: {
    opacity: 1,
    transform: 'translateY(0px) scale(1)',
    transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] },
  },
};

// For scroll-reveal of sections. Only opacity + transform, GPU-friendly.
export const revealVariants: Variants = {
  hidden: { opacity: 0, transform: 'translateY(16px)' },
  visible: {
    opacity: 1,
    transform: 'translateY(0px)',
    transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] },
  },
};

export function useStagger(initial: number): Variants {
  const reduced = useReducedMotion();
  return {
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : 0.06,
        delayChildren: reduced ? 0 : 0.05,
      },
    },
  };
}

export function useChildVariants(): Variants {
  const reduced = useReducedMotion();
  return {
    hidden: reduced ? { opacity: 0 } : { opacity: 0, transform: 'translateY(14px) scale(0.97)' },
    visible: reduced
      ? { opacity: 1, transition: { duration: 0.12, ease: [0.23, 1, 0.32, 1] } }
      : {
          opacity: 1,
          transform: 'translateY(0px) scale(1)',
          transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] },
        },
  };
}

type RevealProps = {
  children: ReactNode;
  className?: string;
} & Omit<
  ComponentProps<typeof motion.div>,
  'children' | 'className' | 'variants' | 'initial' | 'whileInView' | 'viewport'
>;

// Scroll-triggered entrance for less-frequent content (page sections, lists).
export function Reveal({ children, className, ...props }: RevealProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduced ? undefined : revealVariants}
      initial={reduced ? false : 'hidden'}
      whileInView={reduced ? undefined : 'visible'}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

type StaggerProps = {
  children: ReactNode;
  className?: string;
} & Omit<
  ComponentProps<typeof motion.div>,
  'children' | 'className' | 'variants' | 'initial' | 'animate'
>;

// Wrapper for a group of items that animate in one-by-one (30-80ms stagger).
// Child elements must use `motion.div` with `Item` variants (see `StaggerItem`).
export function Stagger({ children, className, ...props }: StaggerProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        visible: {
          transition: { staggerChildren: reduced ? 0 : 0.06, delayChildren: reduced ? 0 : 0.04 },
        },
      }}
      initial="hidden"
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  );
}

type StaggerItemProps = {
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof motion.div>, 'children' | 'className' | 'variants'>;

// One child inside a `Stagger` group.
export function StaggerItem({ children, className, ...props }: StaggerItemProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={
        reduced
          ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.12 } } }
          : {
              hidden: { opacity: 0, transform: 'translateY(14px) scale(0.97)' },
              visible: {
                opacity: 1,
                transform: 'translateY(0px) scale(1)',
                transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] },
              },
            }
      }
      {...props}
    >
      {children}
    </motion.div>
  );
}
