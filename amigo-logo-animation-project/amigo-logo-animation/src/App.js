import { motion, useAnimate } from "framer-motion";
import { useEffect } from "react";

import "./styles.css";

const LETTERS = [
  {
    className: "letter-a",
    d: "M 12 72 L 27 18 L 43 72 M 17 59 H 31"
  },
  {
    className: "letter-m",
    d: "M 58 72 L 60 18 L 81 56 L 102 18 L 106 72"
  },
  {
    className: "letter-i",
    d: "M 125 18 V 72 M 116 18 H 134 M 116 72 H 134"
  },
  {
    className: "letter-g",
    d: "M 214 31 C 208 22 198 18 187 18 C 169 18 155 31 155 45 C 155 60 169 72 187 72 C 201 72 212 65 217 57 V 48 H 192"
  },
  {
    className: "letter-o",
    d: "M 259 18 C 276 18 290 31 292 45 C 294 58 285 69 272 73 M 252 72 C 237 70 226 59 226 45 C 226 32 237 21 252 18"
  }
];

function AnimatedLetter({ className, d }) {
  return (
    <>
      <motion.path
        className={`logo-path ${className} lead`}
        initial={{ pathLength: 0.5, pathOffset: 0.5 }}
        d={d}
      />
      <motion.path
        className={`logo-path ${className} trail`}
        initial={{ pathLength: 0, pathOffset: 1 }}
        d={d}
      />
    </>
  );
}

export default function App() {
  const [scope, animate] = useAnimate();

  useEffect(() => {
    const controls = LETTERS.map((letter) =>
      animate(
        [
          [`.${letter.className}.lead`, { pathLength: 0.5, pathOffset: 0 }],
          [`.${letter.className}.lead`, { pathLength: 0.005, pathOffset: 0 }],
          [`.${letter.className}.trail`, { pathLength: 0.5, pathOffset: 0.5 }, { at: "<" }]
        ],
        {
          duration: 2,
          ease: "linear",
          repeat: Infinity
        }
      )
    );

    return () => controls.forEach((control) => control.stop());
  }, [animate]);

  return (
    <main className="logo-stage">
      <svg
        ref={scope}
        className="amigo-logo"
        viewBox="0 0 306 90"
        role="img"
        aria-label="Animated AMIGO logo"
      >
        <rect width="306" height="90" fill="#000" />
        {LETTERS.map((letter) => (
          <AnimatedLetter key={letter.className} {...letter} />
        ))}
      </svg>
    </main>
  );
}
