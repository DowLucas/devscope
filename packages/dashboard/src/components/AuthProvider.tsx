import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { authClient } from "@/lib/auth-client";

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
    >
      {children}
    </AuthUIProvider>
  );
}
