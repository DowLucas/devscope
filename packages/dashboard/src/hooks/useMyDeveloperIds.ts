import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

interface LinkedDeveloper {
  developer_id: string;
  name: string;
  email: string;
}

interface State {
  ids: Set<string>;
  loading: boolean;
}

/**
 * Returns the set of developer hashes linked to the currently signed-in user
 * within the active organization. Used to gate "self-only" surfaces such as
 * `DeveloperDrillDown` (DEV-31): per-developer breakdown is restricted to the
 * developer themselves.
 *
 * The actual access decision is enforced by the backend; this hook exists so
 * the dashboard can render a self-only notice instead of a permanent error
 * state when a non-self viewer would land on a per-developer surface.
 */
export function useMyDeveloperIds(): State {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const activeOrgId = activeOrg?.id ?? null;

  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOrgId) {
      setIds(new Set());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch("/api/teams/my-linked-developers")
      .then(async (res) => {
        if (!res.ok) return [] as LinkedDeveloper[];
        return (await res.json()) as LinkedDeveloper[];
      })
      .then((rows) => {
        if (cancelled) return;
        setIds(new Set(rows.map((r) => r.developer_id)));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIds(new Set());
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  return { ids, loading };
}
