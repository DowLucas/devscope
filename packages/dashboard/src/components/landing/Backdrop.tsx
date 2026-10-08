import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Section backdrops: glows, a faded grid or dot field, and film       */
/*  grain. All generated in CSS / an inline SVG filter, so there are    */
/*  no image assets to license or load. The grid and dot patterns       */
/*  follow Magic UI's GridPattern / DotPattern (MIT).                   */
/* ------------------------------------------------------------------ */

/** Brand colours: the logo's green, and the blue/violet of the headline gradient. */
const GREEN = "18 224 127";
const BLUE = "96 165 250";
const VIOLET = "167 139 250";

/** SVG turbulence as a data URI: the usual "grainy gradient" trick. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

type Pattern = "grid" | "dots" | "none";

interface Glow {
  color: "green" | "blue" | "violet";
  /** CSS position of the glow's centre, e.g. "20% 10%". */
  at: string;
  /** Ellipse size, e.g. "60% 50%". */
  size?: string;
  opacity?: number;
}

interface BackdropProps {
  pattern?: Pattern;
  glows?: Glow[];
  grain?: boolean;
  /** Where the pattern is fully visible before it fades out. */
  fadeFrom?: "center" | "top" | "bottom";
  className?: string;
}

const RGB = { green: GREEN, blue: BLUE, violet: VIOLET };

const FADE = {
  center: "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 75%)",
  top: "linear-gradient(to bottom, black 0%, transparent 70%)",
  bottom: "linear-gradient(to top, black 0%, transparent 70%)",
};

export function Backdrop({ pattern = "none", glows = [], grain = true, fadeFrom = "center", className }: BackdropProps) {
  const glowLayers = glows
    .map((g) => `radial-gradient(ellipse ${g.size ?? "50% 45%"} at ${g.at}, rgb(${RGB[g.color]} / ${g.opacity ?? 0.14}), transparent 70%)`)
    .join(", ");

  const patternImage =
    pattern === "grid"
      ? "linear-gradient(to right, rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.05) 1px, transparent 1px)"
      : pattern === "dots"
        ? "radial-gradient(rgb(255 255 255 / 0.09) 1px, transparent 1px)"
        : null;

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      {glowLayers ? <div className="absolute inset-0" style={{ backgroundImage: glowLayers }} /> : null}
      {patternImage ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: patternImage,
            backgroundSize: pattern === "grid" ? "48px 48px" : "22px 22px",
            maskImage: FADE[fadeFrom],
            WebkitMaskImage: FADE[fadeFrom],
          }}
        />
      ) : null}
      {grain ? (
        <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      ) : null}
    </div>
  );
}
