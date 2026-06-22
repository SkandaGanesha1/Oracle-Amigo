import staticLogoUrl from "../../assets/amigo-logo/amigo-logo-static.svg";

interface AmigoLogoLoaderProps {
  label?: string;
  className?: string;
  status?: boolean;
}

const LETTERS = [
  {
    className: "letter-a",
    d: "M 12 72 L 27 18 L 43 72 M 17 59 H 31",
  },
  {
    className: "letter-m",
    d: "M 58 72 L 60 18 L 81 56 L 102 18 L 106 72",
  },
  {
    className: "letter-i",
    d: "M 125 18 V 72 M 116 18 H 134 M 116 72 H 134",
  },
  {
    className: "letter-g",
    d: "M 214 31 C 208 22 198 18 187 18 C 169 18 155 31 155 45 C 155 60 169 72 187 72 C 201 72 212 65 217 57 V 48 H 192",
  },
  {
    className: "letter-o",
    d: "M 259 18 C 276 18 290 31 292 45 C 294 58 285 69 272 73 M 252 72 C 237 70 226 59 226 45 C 226 32 237 21 252 18",
  },
] as const;

export function AmigoLogoLoader({
  label = "Loading Oracle Amigo...",
  className,
  status = true,
}: AmigoLogoLoaderProps) {
  return (
    <div
      className={["oa-amigo-loader", className].filter(Boolean).join(" ")}
      data-testid="amigo-logo-loader"
      role={status ? "status" : undefined}
      aria-live={status ? "polite" : undefined}
    >
      <div className="oa-amigo-loader-mark" aria-hidden="true">
        <svg className="oa-amigo-loader-svg" viewBox="0 0 306 90" focusable="false">
          <rect width="306" height="90" />
          {LETTERS.map((letter) => (
            <g key={letter.className}>
              <path className={`oa-amigo-logo-path ${letter.className} lead`} pathLength="1" d={letter.d} />
              <path className={`oa-amigo-logo-path ${letter.className} trail`} pathLength="1" d={letter.d} />
            </g>
          ))}
        </svg>
        <img className="oa-amigo-loader-static" src={staticLogoUrl} alt="" />
      </div>
      <p>{label}</p>
    </div>
  );
}
