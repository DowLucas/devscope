import { type ReactNode, useCallback, useEffect, useRef, useState, createElement } from "react";
import { useLocation, Link } from "wouter";
import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { authClient } from "@/lib/auth-client";

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

export function useListApiKeys() {
  const { data: session } = authClient.useSession();
  const [apiKeys, setApiKeys] = useState<any[] | undefined>(undefined);
  const [isPending, setIsPending] = useState(true);
  const fetchRef = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++fetchRef.current;
    setIsPending(true);
    try {
      const res = await authClient.apiKey.list();
      if (id !== fetchRef.current) return;
      const data = (res as any)?.data;
      setApiKeys(Array.isArray(data) ? data : data?.apiKeys ?? []);
    } catch {
      if (id === fetchRef.current) setApiKeys([]);
    } finally {
      if (id === fetchRef.current) setIsPending(false);
    }
  }, []);

  useEffect(() => {
    if (session) refetch();
  }, [session, refetch]);

  return { data: apiKeys, isPending, refetch };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();

  return (
    <AuthUIProvider
      authClient={authClient}
      navigate={setLocation}
      Link={Link}
      apiKey={true}
      hooks={{ useListApiKeys }}
      account={{ basePath: "/dashboard/account" }}
      social={{ providers: ["github", "google"] }}
      credentials={{ confirmPassword: true }}
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
