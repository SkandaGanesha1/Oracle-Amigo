import { AnimatePresence, LayoutGroup, m, motion, type Variants } from "motion/react";

export { AnimatePresence, LayoutGroup, m, motion };

export const motionTransition = {
  spring: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 },
  quick: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
  panel: { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
} as const;

export const appShellVariants: Variants = {
  initial: { opacity: 0, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -4, filter: "blur(2px)" }
};

export const listContainerVariants: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.02
    }
  }
};

export const listItemVariants: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.99 }
};

export const detailPanelVariants: Variants = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 14 }
};

export const overlayVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
};

export const modalPanelVariants: Variants = {
  initial: { opacity: 0, y: 16, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 10, scale: 0.985 }
};

export const drawerVariants: Variants = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 32 }
};

export const missionStepVariants: Variants = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -4 }
};

export const decisionActionMotion = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.98 }
} as const;
