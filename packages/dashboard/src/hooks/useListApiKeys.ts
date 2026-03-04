import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface ApiKeyRecord {
  id: string;
  name: string | null;
  start: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  [key: string]: unknown;
}

export function useListApiKeys() {
  const { data: session } = authClient.useSession();
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[] | undefined>(undefined);
  const [isPending, setIsPending] = useState(true);
  const fetchRef = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++fetchRef.current;
    setIsPending(true);
    try {
      const res = await authClient.apiKey.list();
      if (id !== fetchRef.current) return;
      const data = (res as unknown as { data?: ApiKeyRecord[] | { apiKeys: ApiKeyRecord[] } })?.data;
      setApiKeys(Array.isArray(data) ? data : (data as { apiKeys: ApiKeyRecord[] })?.apiKeys ?? []);
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
