import { useState } from "react";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

/* ------------------------------------------------------------------ */
/* Landing page sticky navigation bar                                  */
/* Glass-morphism effect with backdrop blur, matching dashboard header  */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { label: "Features", href: "features" },
  { label: "How It Works", href: "how-it-works" },
  { label: "FAQ", href: "faq" },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Brand */}
        <a href="/" className="text-lg font-semibold tracking-tight text-foreground hover:text-foreground/80 transition-colors">
          DevScope
        </a>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <button
              key={link.href}
              onClick={() => scrollTo(link.href)}
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-4">
          <a
            href="/auth/sign-in"
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign In
          </a>
          <a
            href="/auth/sign-up"
            className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Get Started
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile slide-down menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden overflow-hidden border-b border-border bg-background/95 backdrop-blur-lg"
          >
            <div className="px-4 py-4 space-y-3">
              {NAV_LINKS.map((link) => (
                <button
                  key={link.href}
                  onClick={() => {
                    scrollTo(link.href);
                    setMobileOpen(false);
                  }}
                  className="block w-full text-left text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </button>
              ))}
              <div className="pt-3 border-t border-border space-y-2">
                <a
                  href="/auth/sign-in"
                  className="block text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Sign In
                </a>
                <a
                  href="/auth/sign-up"
                  className="block rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors text-center"
                >
                  Get Started
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
