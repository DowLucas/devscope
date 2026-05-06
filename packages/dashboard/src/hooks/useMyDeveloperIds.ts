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

interface FetchedData {
  orgId: string;
  ids: Set<string>;
}

const EMPTY_IDS: Set<string> = new Set();

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

  // Cache the most recent successful fetch keyed by orgId. Loading and empty
  // states are derived from (activeOrgId, data) rather than synced via
  // setState in the effect body — this avoids react-hooks/set-state-in-effect.
  const [data, setData] = useState<FetchedData | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    let cancelled = false;
    apiFetch("/api/teams/my-linked-developers")
      .then(async (res) => {
        if (!res.ok) return [] as LinkedDeveloper[];
        return (await res.json()) as LinkedDeveloper[];
      })
      .then((rows) => {
        if (cancelled) return;
        setData({
          orgId: activeOrgId,
          ids: new Set(rows.map((r) => r.developer_id)),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setData({ orgId: activeOrgId, ids: new Set() });
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  if (!activeOrgId) return { ids: EMPTY_IDS, loading: false };
  if (!data || data.orgId !== activeOrgId) {
    return { ids: EMPTY_IDS, loading: true };
  }
  return { ids: data.ids, loading: false };
}
