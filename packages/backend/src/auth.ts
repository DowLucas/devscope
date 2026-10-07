import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { organization } from "better-auth/plugins/organization";
import { Pool } from "pg";
import { sendInviteEmail, sendVerificationEmail, sendWelcomeEmail } from "./services/email";
import { disconnectUserFromOrg } from "./ws/handler";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:6767",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  user: {
    modelName: "auth_user",
    additionalFields: {
      acceptedTerms: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: true,
      },
    },
  },
  session: {
    modelName: "auth_session",
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  emailAndPassword: {
    enabled: true,
    // Account emails are otherwise trusted as identity (developerId =
    // sha256(email), invitation matching), so they must be proven first.
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      void sendVerificationEmail({
        to: user.email,
        url,
        name: user.name,
      });
    },
    sendOnSignUp: true,
    // A sign-in blocked by requireEmailVerification re-sends the link.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
  },
  databaseHooks: {
    account: {
      create: {
        // Pre-account-takeover guard. Better Auth implicitly links a verified
        // Google/GitHub identity onto an existing user with the same email and
        // then marks that user verified -- without checking that the local
        // account was ever verified. If the existing user is unverified, whoever
        // registered the address first (possibly an attacker) holds a password
        // and sessions. Purge both before the OAuth identity is attached, so the
        // real owner ends up as the only party in control.
        before: async (account) => {
          const providerId = (account as { providerId?: string }).providerId;
          const userId = (account as { userId?: string }).userId;
          if (!userId || !providerId || providerId === "credential") return;
          const { rows } = await pool.query(
            'SELECT "emailVerified" FROM auth_user WHERE id = $1',
            [userId],
          );
          // No row = brand-new OAuth signup; verified = legitimate link.
          if (!rows[0] || rows[0].emailVerified) return;
          await pool.query(
            `DELETE FROM auth_account WHERE "userId" = $1 AND "providerId" = 'credential'`,
            [userId],
          );
          await pool.query('DELETE FROM auth_session WHERE "userId" = $1', [userId]);
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          if (user.emailVerified) {
            void sendWelcomeEmail({ to: user.email, name: user.name });
          }
        },
      },
    },
  },
  advanced: {
    cookiePrefix: "devscope",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  },
  trustedOrigins: (process.env.GC_CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim()),
  plugins: [
    apiKey({
      // Off: better-auth resets a key's count only after a full window with no
      // request, so a session sending events steadily (even 2/s) ran into "15
      // per second" over and over, and better-auth 1.5 throws that as a 401,
      // which the plugin drops. Our own per-route limits (rateLimitMiddleware:
      // 300/min per key owner, /api/events 120/min, /api/ai, /api/similar)
      // are fixed windows and answer 429, which the plugin retries.
      rateLimit: { enabled: false },
    }),
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      invitationExpiresIn: 7 * 24 * 60 * 60,
      // Invitations match on the email string only; without this, anyone who
      // registers the invitee's (unverified) address can accept the invite.
      requireEmailVerificationOnInvitation: true,
      organizationHooks: {
        // removeMember only clears activeOrganizationId on the caller's own
        // session, so drop it from the removed user's sessions for that org.
        afterRemoveMember: async ({ member }) => {
          await pool.query(
            'UPDATE auth_session SET "activeOrganizationId" = NULL WHERE "userId" = $1 AND "activeOrganizationId" = $2',
            [member.userId, member.organizationId],
          );
          disconnectUserFromOrg(member.organizationId, member.userId);
        },
      },
      async sendInvitationEmail(data) {
        const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:5173";
        const acceptUrl = `${baseUrl}/invite/${data.id}`;
        await sendInviteEmail({
          to: data.email,
          inviterName: data.inviter.user.name,
          organizationName: data.organization.name,
          role: data.role,
          acceptUrl,
        });
      },
    }),
  ],
});
