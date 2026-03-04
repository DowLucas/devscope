import { LandingNav } from "./LandingNav";
import { FooterSection } from "./FooterSection";
import { PersonaProvider } from "./PersonaContext";

export function TermsPage() {
  return (
    <PersonaProvider>
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <main className="pt-14">
        <div className="max-w-3xl mx-auto px-4 py-16">
          <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Last updated: March 4, 2026
          </p>

          <div className="prose prose-sm prose-invert max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-foreground">
            <h2>1. Agreement</h2>
            <p>
              These Terms of Service ("Terms") govern your use of DevScope, a
              real-time observability platform for agentic engineering sessions,
              operated by <strong>Dow Technology</strong> (enskild firma),
              Sweden. By accessing or using DevScope at{" "}
              <a href="https://devscope.sh" className="text-primary hover:underline">
                devscope.sh
              </a>
              , you agree to these Terms.
            </p>

            <h2>2. Description of Service</h2>
            <p>
              DevScope provides a monitoring dashboard and plugin that tracks
              developer session activity from Claude Code. The service collects
              session events, tool usage, and developer activity metadata to
              present real-time and historical insights. Data collection is
              privacy-preserving by default; detailed session content (prompt
              text, tool inputs) is only transmitted and stored when you
              explicitly opt in via the plugin configuration and the dashboard
              Data Sharing settings.
            </p>

            <h2>3. Accounts</h2>
            <p>
              You must create an account to use DevScope. You are responsible for
              maintaining the confidentiality of your account credentials and for
              all activity under your account. You must provide accurate
              information during registration.
            </p>

            <h2>4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Use the service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to the service or its systems</li>
              <li>Interfere with or disrupt the service's infrastructure</li>
              <li>Reverse-engineer or attempt to extract the source code of proprietary components</li>
              <li>Resell or redistribute access to the service without permission</li>
            </ul>

            <h2>5. Third-Party Authentication</h2>
            <p>
              DevScope allows you to sign in using Google or GitHub via OAuth.
              By choosing to authenticate through a third-party provider, you
              are also subject to that provider's terms of service and privacy
              policy. Dow Technology is not responsible for the practices of
              these third-party services.
            </p>

            <h2>6. Open Source Components</h2>
            <p>
              Portions of DevScope are released under the MIT license. However,
              certain components, branding, and the hosted service itself may be
              subject to separate terms. These Terms apply specifically to the
              hosted service operated by Dow Technology.
            </p>

            <h2>7. Data &amp; Privacy</h2>
            <p>
              Your use of DevScope is also governed by our{" "}
              <a href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </a>
              . DevScope is designed with consent-first principles: the plugin
              defaults to standard mode (
              <code>DEVSCOPE_PRIVACY=standard</code>) and detailed session data
              collection requires explicit opt-in at both the plugin
              configuration level and via the dashboard Data Sharing settings.
              By using the service, you consent to the collection and processing
              of data as described in the Privacy Policy.
            </p>

            <h2>8. Availability &amp; Warranty Disclaimer</h2>
            <p>
              DevScope is provided <strong>"as is"</strong> and{" "}
              <strong>"as available"</strong> without warranties of any kind,
              express or implied. Dow Technology does not guarantee uninterrupted
              or error-free service.
            </p>

            <h2>9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Dow Technology shall not be
              liable for any indirect, incidental, special, or consequential
              damages arising from your use of DevScope, including loss of data,
              revenue, or profits.
            </p>

            <h2>10. Termination</h2>
            <p>
              Either party may terminate the relationship at any time. You may
              delete your account through the settings page. Dow Technology
              reserves the right to suspend or terminate accounts that violate
              these Terms.
            </p>

            <h2>11. Changes to Terms</h2>
            <p>
              Dow Technology may update these Terms from time to time. Continued
              use of the service after changes constitutes acceptance. Material
              changes will be communicated via the dashboard or email.
            </p>

            <h2>12. Governing Law</h2>
            <p>
              These Terms are governed by the laws of Sweden. Any disputes shall
              be resolved in the courts of Sweden.
            </p>

            <h2>13. Contact</h2>
            <p>
              For questions about these Terms, contact us at{" "}
              <a
                href="mailto:lucdow7@gmail.com"
                className="text-primary hover:underline"
              >
                lucdow7@gmail.com
              </a>
              .
            </p>
          </div>
        </div>
      </main>
      <FooterSection />
    </div>
    </PersonaProvider>
  );
}
