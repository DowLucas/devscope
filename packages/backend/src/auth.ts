import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { organization } from "better-auth/plugins/organization";
import { Pool } from "pg";
import { sendInviteEmail, sendVerificationEmail } from "./services/email";

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
  session: { modelName: "auth_session" },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
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
    autoSignInAfterVerification: true,
    expiresIn: 3600,
  },
  trustedOrigins: (process.env.GC_CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim()),
  plugins: [
    apiKey({
      rateLimit: {
        enabled: true,
        maxRequests: 100,
        timeWindow: 1000, // 100 requests per second
      },
    }),
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      invitationExpiresIn: 7 * 24 * 60 * 60,
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
