import { Resend } from "resend";

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
      subject: `You've been invited to ${params.organizationName} on DevScope`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>You're invited!</h2>
          <p><strong>${params.inviterName}</strong> has invited you to join
             <strong>${params.organizationName}</strong> as a <strong>${params.role}</strong>
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
