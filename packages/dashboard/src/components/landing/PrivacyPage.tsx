import { LandingNav } from "./LandingNav";
import { FooterSection } from "./FooterSection";
import { PersonaProvider } from "./PersonaContext";

export function PrivacyPage() {
  return (
    <PersonaProvider>
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <main className="pt-14">
        <div className="max-w-3xl mx-auto px-4 py-16">
          <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Last updated: March 4, 2026
          </p>

          <div className="prose prose-sm prose-invert max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-foreground">
            <h2>1. Who We Are</h2>
            <p>
              DevScope is operated by <strong>Dow Technology</strong> (enskild
              firma), Sweden. We are the data controller for the personal data
              processed through the DevScope service.
            </p>

            <h2>2. What Data We Collect</h2>
            <p>
              DevScope collects data in two tiers: data that is always collected
              when you use the plugin, and data that is only collected when you
              explicitly opt in.
            </p>

            <p className="font-medium text-foreground">Always collected (no opt-in required):</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Account data</strong> — email address, name, and
                password hash if you register with email/password; or your
                email address and display name returned by your OAuth provider
                (Google or GitHub) if you sign in with a social account
              </li>
              <li>
                <strong>Developer identity</strong> — a SHA-256 hash of your Git
                email address, used to link sessions to developers (the raw
                email is never stored by the plugin)
              </li>
              <li>
                <strong>Session metadata</strong> — session start/end
                timestamps, duration, model name, and project directory name
              </li>
              <li>
                <strong>Event types</strong> — which Claude Code lifecycle hooks
                fired (e.g. tool call, prompt submit, session start/end)
              </li>
              <li>
                <strong>Tool names</strong> — the name of each tool invoked
                (e.g. <code>Read</code>, <code>Bash</code>, <code>Grep</code>),
                but not the inputs or outputs
              </li>
              <li>
                <strong>Prompt length</strong> — character count of prompts
                submitted, not the text itself
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

            <p className="font-medium text-foreground mt-4">
              Opt-in: Plugin privacy mode (<code className="text-sm bg-muted px-1 rounded">standard</code> or <code className="text-sm bg-muted px-1 rounded">open</code>)
            </p>
            <p>
              When you configure the plugin with a mode above the default, the
              following additional data is transmitted:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Prompt text</strong> — full text of messages submitted
                to the model (<code>standard</code> and <code>full</code>)
              </li>
              <li>
                <strong>Tool inputs</strong> — parameters passed to each tool
                call (file contents, command strings, etc.) (<code>standard</code>{" "}
                and <code>full</code>)
              </li>
              <li>
                <strong>Response text</strong> — full assistant response
                content (<code>open</code> only)
              </li>
              <li>
                <strong>Git remote URL</strong> — the remote origin of the
                repository (<code>open</code> only)
              </li>
            </ul>
            <p>
              The default plugin mode is <code>DEVSCOPE_PRIVACY=standard</code>, which
              transmits metadata plus prompt text and tool inputs — response text is not sent.
            </p>

            <p className="font-medium text-foreground mt-4">
              Opt-in: Dashboard "Share session details" toggle
            </p>
            <p>
              In Settings → Data Sharing, you can enable a toggle that controls
              whether detailed content (prompt text, tool inputs, response text) is
              retained in your personal session views. This data is{" "}
              <strong>never</strong> visible to other team members regardless of
              this setting — it is only accessible to you in your own session views.
              Both the plugin <code>open</code> mode and this toggle must be enabled
              for detailed content to be stored.
            </p>

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
                <strong>Consent</strong> — for the plugin's{" "}
                <code>DEVSCOPE_PRIVACY=open</code> mode and the dashboard
                "Share session details" toggle. Both are opt-in. You can
                withdraw consent at any time by switching back to{" "}
                <code>standard</code> or <code>private</code> mode, or
                disabling the toggle in Settings.
              </li>
            </ul>

            <h2>5. Data Sharing</h2>
            <p>
              We do not sell your personal data. Data visible to your organization
              is <strong>limited to aggregate metadata only</strong> — event types,
              tool names, session timing, and activity counts. Prompt text, tool
              inputs, and response text are <strong>never</strong> visible to other
              team members, even when you opt in to storing them. When you opt in,
              that detailed content is visible only to you in your personal session
              views.
            </p>
            <p>We may share data with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Infrastructure providers (hosting, database) necessary to operate the service</li>
              <li>Law enforcement when required by applicable law</li>
            </ul>

            <h2>6. Data Retention</h2>
            <p>
              Account data is retained while your account is active. Session
              events are retained for the duration of your subscription. You may
              request deletion of your data at any time by contacting us or
              deleting your account. You can also submit a data export or
              deletion request directly from the dashboard under Settings →
              Privacy, without needing to contact us by email.
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
            <p>
              You can exercise many of these rights directly from the dashboard
              under Settings → Privacy (data export and deletion requests), or
              by contacting us at{" "}
              <a href="mailto:lucdow7@gmail.com" className="text-primary hover:underline">
                lucdow7@gmail.com
              </a>
              .
            </p>

            <h2>8. Security</h2>
            <p>
              We implement appropriate technical and organizational measures to
              protect your data, including encrypted connections (TLS),
              hashed credentials, and access controls. The plugin hashes
              developer email addresses client-side before transmission. When
              the plugin operates in <code>private</code> mode,
              potentially sensitive inputs such as Bash commands and file
              contents are sanitized client-side and never transmitted to our
              servers.
            </p>

            <h2>9. Third-Party Authentication (OAuth)</h2>
            <p>
              DevScope supports signing in with Google and GitHub. If you choose
              to authenticate via one of these providers, we receive your name
              and email address from that provider as part of the OAuth flow. We
              do not receive your OAuth provider password or any other account
              data beyond what is required to create or link your DevScope
              account.
            </p>
            <p>
              By using social sign-in you are also subject to the privacy policy
              of the respective provider:{" "}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Google Privacy Policy
              </a>{" "}
              and{" "}
              <a
                href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                GitHub Privacy Statement
              </a>
              .
            </p>

            <h2>10. Cookies</h2>
            <p>
              DevScope uses essential cookies for authentication and session
              management. We do not use third-party tracking cookies or
              advertising cookies.
            </p>

            <h2>11. Plugin Privacy Modes</h2>
            <p>
              The plugin's privacy mode is configured in{" "}
              <code>~/.config/devscope/config</code> (set during setup or via
              the <code>/devscope:setup</code> command). Three modes are
              supported:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>
                  <code>private</code>
                </strong>{" "}
                — Only metadata is transmitted: tool names, file
                paths (not contents), prompt character counts, and session
                timing. Bash commands, prompt text, tool inputs, and response
                content are not sent.
              </li>
              <li>
                <strong>
                  <code>standard</code>
                </strong>{" "}
                (default) — Transmits everything in <code>private</code> mode,
                plus full prompt text and raw tool inputs. Response text is not sent.
              </li>
              <li>
                <strong>
                  <code>open</code>
                </strong>{" "}
                — Transmits everything in <code>standard</code> mode, plus full
                response text and Git remote URLs.
              </li>
            </ul>
            <p>
              You can change your privacy mode at any time by editing your
              config file or re-running <code>/devscope:setup</code>.
            </p>

            <h2>12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will
              be posted on this page with an updated date. Material changes will
              be communicated via the dashboard or email.
            </p>

            <h2>13. Contact</h2>
            <p>
              For privacy-related questions or to exercise your rights, contact
              us at{" "}
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
