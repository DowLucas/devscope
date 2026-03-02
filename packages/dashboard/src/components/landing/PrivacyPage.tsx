import { LandingNav } from "./LandingNav";
import { FooterSection } from "./FooterSection";

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <main className="pt-14">
        <div className="max-w-3xl mx-auto px-4 py-16">
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Last updated: March 2, 2026
          </p>

          <div className="prose prose-sm prose-invert max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-foreground">
            <h2>1. Who We Are</h2>
            <p>
              DevScope is operated by <strong>Dow Technology</strong> (enskild
              firma), Sweden. We are the data controller for the personal data
              processed through the DevScope service.
            </p>

            <h2>2. What Data We Collect</h2>
            <p>We collect the following data when you use DevScope:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Account data</strong> — email address, name, and
                password hash provided during registration
              </li>
              <li>
                <strong>Developer identity</strong> — a SHA-256 hash of your Git
                email address, used to link sessions to developers (the raw
                email is not stored by the plugin)
              </li>
              <li>
                <strong>Session events</strong> — session start/end timestamps,
                tool usage events, project names, and event metadata sent by the
                Claude Code plugin
              </li>
              <li>
                <strong>Organization data</strong> — team name and membership
                information if you create or join an organization
              </li>
              <li>
                <strong>Technical data</strong> — IP address, browser user
                agent, and request logs for security and diagnostics
              </li>
            </ul>

            <h2>3. How We Use Your Data</h2>
            <p>We process your data to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Provide the DevScope monitoring dashboard and real-time event feed</li>
              <li>Generate insights and analytics about developer activity</li>
              <li>Manage your account, organization membership, and API keys</li>
              <li>Maintain the security and stability of the service</li>
            </ul>

            <h2>4. Legal Basis (GDPR)</h2>
            <p>We process personal data on the following legal bases:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Contract</strong> — processing necessary to provide the
                service you signed up for
              </li>
              <li>
                <strong>Legitimate interest</strong> — security monitoring,
                abuse prevention, and service improvement
              </li>
              <li>
                <strong>Consent</strong> — where required, such as optional
                analytics or communications
              </li>
            </ul>

            <h2>5. Data Sharing</h2>
            <p>
              We do not sell your personal data. Session data and insights are
              visible to members of your organization. We may share data with:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Infrastructure providers (hosting, database) necessary to operate the service</li>
              <li>Law enforcement when required by applicable law</li>
            </ul>

            <h2>6. Data Retention</h2>
            <p>
              Account data is retained while your account is active. Session
              events are retained for the duration of your subscription. You may
              request deletion of your data at any time by contacting us or
              deleting your account.
            </p>

            <h2>7. Your Rights</h2>
            <p>Under GDPR and applicable Swedish law, you have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Restrict or object to processing</li>
              <li>Data portability</li>
              <li>Lodge a complaint with the Swedish Authority for Privacy Protection (IMY)</li>
            </ul>

            <h2>8. Security</h2>
            <p>
              We implement appropriate technical and organizational measures to
              protect your data, including encrypted connections (TLS),
              hashed credentials, and access controls. The plugin hashes
              developer email addresses client-side before transmission.
            </p>

            <h2>9. Cookies</h2>
            <p>
              DevScope uses essential cookies for authentication and session
              management. We do not use third-party tracking cookies or
              advertising cookies.
            </p>

            <h2>10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will
              be posted on this page with an updated date. Material changes will
              be communicated via the dashboard or email.
            </p>

            <h2>11. Contact</h2>
            <p>
              For privacy-related questions or to exercise your rights, contact
              us at{" "}
              <a
                href="mailto:hello@devscope.dev"
                className="text-primary hover:underline"
              >
                hello@devscope.dev
              </a>
              .
            </p>
          </div>
        </div>
      </main>
      <FooterSection />
    </div>
  );
}
