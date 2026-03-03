import { Resend } from "resend";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    console.log(`[devscope] RESEND_API_KEY not set — verification email for ${params.to} skipped (verify URL: ${params.url})`);
    return;
  }

  const from = process.env.RESEND_FROM ?? "DevScope <noreply@devscope.dev>";
  const name = params.name || params.to.split("@")[0];

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: "Verify your email address — DevScope",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Verify your email</h2>
          <p>Hi ${escapeHtml(name)}, thanks for signing up for DevScope.</p>
          <p>Click the button below to verify your email address and get started.</p>
          <a href="${params.url}"
             style="display: inline-block; padding: 12px 24px; background: #18181b; color: #fff;
                    border-radius: 6px; text-decoration: none; font-weight: 500;">
            Verify Email
          </a>
          <p style="color: #71717a; font-size: 14px; margin-top: 24px;">
            This link expires in 1 hour. If you didn't create an account, you can ignore this email.
          </p>
        </div>
      `,
    });
    console.log(`[devscope] Verification email sent to ${params.to}`);
  } catch (err) {
    console.error(`[devscope] Failed to send verification email to ${params.to}:`, err);
  }
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const resend = getClient();
  if (!resend) {
    console.log(`[devscope] RESEND_API_KEY not set — invite email for ${params.to} skipped (accept URL: ${params.acceptUrl})`);
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
          <a href="${params.acceptUrl}"
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
