import { type ReactNode, useCallback, useEffect, useRef, useState, createElement, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { authClient } from "@/lib/auth-client";
import { useListApiKeys } from "@/hooks/useListApiKeys";

const TermsLabel = createElement("span", null,
  "I agree to the ",
  createElement("a", {
    href: "/terms",
    target: "_blank",
    className: "underline underline-offset-4 hover:text-foreground transition-colors",
  }, "Terms of Service"),
  " and ",
  createElement("a", {
    href: "/privacy",
    target: "_blank",
    className: "underline underline-offset-4 hover:text-foreground transition-colors",
  }, "Privacy Policy"),
);

const ALL_SOCIAL_PROVIDERS = ["github", "google"] as const;

function useListAccounts() {
  const { data: session } = authClient.useSession();
  const [accounts, setAccounts] = useState<Record<string, unknown>[] | undefined>(undefined);
  const [isPending, setIsPending] = useState(true);
  const fetchRef = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++fetchRef.current;
    setIsPending(true);
    try {
      const res = await authClient.listAccounts();
      if (id !== fetchRef.current) return;
      const data = (res as unknown as { data?: Record<string, unknown>[] })?.data;
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      if (id === fetchRef.current) setAccounts([]);
    } finally {
      if (id === fetchRef.current) setIsPending(false);
    }
  }, []);

  useEffect(() => {
    if (session) refetch();
  }, [session, refetch]);

  return { data: accounts, isPending, refetch };
}

function useAccountInfo() {
  // better-auth-ui passes `account.accountId` (the provider's ID) but
  // better-auth@1.5's /account-info endpoint uses `findAccount()` which
  // looks up by internal `id` — causing ACCOUNT_NOT_FOUND. Skip the call.
  return { data: null, isPending: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { data: session } = authClient.useSession();
  const [linkedProviders, setLinkedProviders] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session) {
      setLinkedProviders(new Set());
      return;
    }
    authClient.listAccounts().then((res) => {
      const data = (res as unknown as { data?: Record<string, unknown>[] })?.data;
      if (Array.isArray(data)) {
        setLinkedProviders(new Set(data.map((a) => String(a.providerId ?? ""))));
      }
    }).catch(() => {});
  }, [session]);

  // Workaround: better-auth-ui's ProvidersCard renders both linked accounts
  // (from useListAccounts) and configured social.providers without deduplication.
  // Only include unlinked providers in social.providers to avoid duplicate rows.
  // When all are linked, pass a dummy provider so the card still renders
  // (the library hides the card when social.providers is empty) — the dummy
  // won't match any known provider so no extra row appears.
  const socialProviders = useMemo(() => {
    const unlinked = ALL_SOCIAL_PROVIDERS.filter((p) => !linkedProviders.has(p));
    return unlinked.length > 0 ? unlinked : ["_placeholder" as (typeof ALL_SOCIAL_PROVIDERS)[number]];
  }, [linkedProviders]);

  return (
    <AuthUIProvider
      authClient={authClient}
      navigate={setLocation}
      Link={Link}
      apiKey={false}
      hooks={{ useListApiKeys, useListAccounts, useAccountInfo } as Parameters<typeof AuthUIProvider>[0]["hooks"]}
      account={{ basePath: "/dashboard/account" }}
      social={{ providers: socialProviders }}
      credentials={{ confirmPassword: import.meta.env.PROD }}
      emailVerification={true}
      additionalFields={{
        acceptedTerms: {
          label: TermsLabel,
          required: true,
          type: "boolean",
        },
      }}
      signUp={{ fields: ["name", "acceptedTerms"] }}
    >
      {children}
    </AuthUIProvider>
  );
}
