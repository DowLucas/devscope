import { Resend } from "resend";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

interface InviteEmailParams {
  to: string;
  inviterName: string;
  organizationName: string;
  role: string;
  acceptUrl: string;
}

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

interface VerificationEmailParams {
  to: string;
  url: string;
  name?: string;
}

export async function sendVerificationEmail(params: VerificationEmailParams): Promise<void> {
  const resend = getClient();
  if (!resend) {
    console.log(`[devscope] RESEND_API_KEY not set — verification email for ${params.to} skipped`);
    return;
  }

  if (!isSafeUrl(params.url)) {
    console.warn(`[devscope] Refusing to send verification email — unsafe URL: ${params.url}`);
    return;
  }

  const from = process.env.RESEND_FROM ?? "Lucas Dow <lucas@devscope.dev>";
  const name = params.name || params.to.split("@")[0];

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: "Welcome to DevScope — please verify your email",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <p>Hey ${escapeHtml(name)},</p>
          <p>Thanks for signing up for DevScope! I'm Lucas — I love building and exploring new ways to use AI in my day-to-day work and hobby projects. DevScope is one of those projects: a real-time dashboard to help developers get better visibility into their Claude Code sessions.</p>
          <p>I'm eager to get feedback and build a community around it, so I'm genuinely excited to have you here.</p>
          <p>Just click the button below to verify your email and get started:</p>
          <a href="${escapeHtml(params.url)}"
             style="display: inline-block; padding: 12px 24px; background: #18181b; color: #fff;
                    border-radius: 6px; text-decoration: none; font-weight: 500;">
            Verify my email
          </a>
          <p>If you have any questions or feedback, just reply to this email — I read everything.</p>
          <p>— Lucas</p>
          <p style="color: #71717a; font-size: 14px; margin-top: 24px;">
            This link expires in 1 hour. If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      `,
    });
    console.log(`[devscope] Verification email sent to ${params.to}`);
  } catch (err) {
    console.error(`[devscope] Failed to send verification email to ${params.to}:`, err);
  }
}

interface WelcomeEmailParams {
  to: string;
  name?: string;
}

export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<void> {
  const resend = getClient();
  if (!resend) {
    console.log(`[devscope] RESEND_API_KEY not set — welcome email for ${params.to} skipped`);
    return;
  }

  const from = process.env.RESEND_FROM ?? "Lucas Dow <lucas@devscope.dev>";
  const name = params.name || params.to.split("@")[0];
  const dashboardUrl = process.env.DASHBOARD_URL || process.env.BETTER_AUTH_URL || "http://localhost:5173";

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: "Welcome to DevScope",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <p>Hey ${escapeHtml(name)},</p>
          <p>Thanks for signing up for DevScope! I'm Lucas — I love building and exploring new ways to use AI in my day-to-day work and hobby projects. DevScope is one of those projects: a real-time dashboard to help developers get better visibility into their Claude Code sessions.</p>
          <p>I'm eager to get feedback and build a community around it, so I'm genuinely excited to have you here.</p>
          <p>Head to the dashboard to get started:</p>
          <a href="${escapeHtml(dashboardUrl)}/dashboard"
             style="display: inline-block; padding: 12px 24px; background: #18181b; color: #fff;
                    border-radius: 6px; text-decoration: none; font-weight: 500;">
            Go to Dashboard
          </a>
          <p>If you have any questions or feedback, just reply to this email — I read everything.</p>
          <p>— Lucas</p>
        </div>
      `,
    });
    console.log(`[devscope] Welcome email sent to ${params.to}`);
  } catch (err) {
    console.error(`[devscope] Failed to send welcome email to ${params.to}:`, err);
  }
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const resend = getClient();
  if (!resend) {
    console.log(`[devscope] RESEND_API_KEY not set — invite email for ${params.to} skipped`);
    return;
  }

  if (!isSafeUrl(params.acceptUrl)) {
    console.warn(`[devscope] Refusing to send invite email — unsafe URL: ${params.acceptUrl}`);
    return;
  }

  const from = process.env.RESEND_FROM ?? "DevScope <noreply@devscope.dev>";

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: `You've been invited to ${escapeHtml(params.organizationName)} on DevScope`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>You're invited!</h2>
          <p><strong>${escapeHtml(params.inviterName)}</strong> has invited you to join
             <strong>${escapeHtml(params.organizationName)}</strong> as a <strong>${escapeHtml(params.role)}</strong>
             on DevScope.</p>
          <a href="${escapeHtml(params.acceptUrl)}"
             style="display: inline-block; padding: 12px 24px; background: #18181b; color: #fff;
                    border-radius: 6px; text-decoration: none; font-weight: 500;">
            Accept Invitation
          </a>
          <p style="color: #71717a; font-size: 14px; margin-top: 24px;">
            This invitation expires in 7 days. If you didn't expect this, you can ignore it.
          </p>
        </div>
      `,
    });
    console.log(`[devscope] Invite email sent to ${params.to}`);
  } catch (err) {
    console.error(`[devscope] Failed to send invite email to ${params.to}:`, err);
  }
}
