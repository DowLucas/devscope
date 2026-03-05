import { useEffect } from "react";
import { useLocation } from "wouter";
import { authClient } from "@/lib/auth-client";
import { PersonaProvider } from "./PersonaContext";
import { PersonaOverlay } from "./PersonaOverlay";
import { LandingNav } from "./LandingNav";
import { HeroSection } from "./HeroSection";
import { FeaturesSection } from "./FeaturesSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { SecuritySection } from "./SecuritySection";
import { StatsSection } from "./StatsSection";
import { FaqSection } from "./FaqSection";
import { CtaSection } from "./CtaSection";
import { FooterSection } from "./FooterSection";
import { TopologyDemoSection } from "./TopologyDemoSection";

/* ------------------------------------------------------------------ */
/* Landing page compositor                                             */
/* Public page — redirects authenticated users to the dashboard.       */
/* Composes all marketing sections into a single-scroll layout.        */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  const { data: session, isPending } = authClient.useSession();
  const [, setLocation] = useLocation();

  /* Redirect authenticated users to dashboard */
  useEffect(() => {
    if (!isPending && session) {
      setLocation("/dashboard");
    }
  }, [isPending, session, setLocation]);

  /* Don't flash landing page content while checking auth */
  if (isPending) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  /* Authenticated users will be redirected — render nothing */
  if (session) return null;

  return (
    <PersonaProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* Persona selection overlay — shown once, then persisted */}
        <PersonaOverlay />

        {/* Sticky navigation bar */}
        <LandingNav />

        {/* Main content — each section handles its own spacing */}
        <main className="pt-14"> {/* offset for fixed nav height */}
          <HeroSection />
          <StatsSection />
          <FeaturesSection />
          <TopologyDemoSection />
          <HowItWorksSection />
          <SecuritySection />
          <FaqSection />
          <CtaSection />
        </main>

        <FooterSection />
      </div>
    </PersonaProvider>
  );
}
