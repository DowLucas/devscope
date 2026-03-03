import { Separator } from "@/components/ui/separator";
import { usePersona } from "./PersonaContext";

/** Product navigation links — anchor IDs or external URLs. */
const PRODUCT_LINKS = [
  { label: "Features", id: "features" },
  { label: "How It Works", id: "how-it-works" },
  { label: "FAQ", id: "faq" },
] as const;

/** Legal links. */
const LEGAL_LINKS = [
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
] as const;

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function FooterSection() {
  const { persona, setPersona } = usePersona();

  return (
    <footer className="border-t border-border">
      <div className="max-w-6xl mx-auto py-12 px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <a href="/" className="text-lg font-bold text-foreground hover:text-foreground/80 transition-colors">
              DevScope
            </a>
            <p className="mt-2 text-sm text-muted-foreground">
              Real-time insights for AI-assisted development.
            </p>
          </div>

          {/* Product links */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">
              Product
            </h4>
            <ul className="space-y-2">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.id}>
                  <button
                    onClick={() => scrollTo(link.id)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
              <li>
                <a
                  href="https://github.com/DowLucas/devscope"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">
              Legal
            </h4>
            <ul className="space-y-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Preferences */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">
              Preferences
            </h4>
            <div className="flex gap-1">
              <button
                onClick={() => setPersona("technical")}
                className={`text-sm transition-colors cursor-pointer ${
                  persona === "technical" || !persona
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Technical
              </button>
              <span className="text-muted-foreground">/</span>
              <button
                onClick={() => setPersona("non-technical")}
                className={`text-sm transition-colors cursor-pointer ${
                  persona === "non-technical"
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Non-technical
              </button>
            </div>
          </div>
        </div>

        <Separator className="mt-8 mb-6" />
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Dow Technology. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
