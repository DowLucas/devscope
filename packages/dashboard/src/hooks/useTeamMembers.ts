import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useTeamStore } from "@/stores/teamStore";
import type { OrgMemberStatus } from "@devscope/shared";

export function useTeamMembers() {
  const currentTeam = useTeamStore((s) => s.currentTeam);
  const setMembers = useTeamStore((s) => s.setMembers);
  const members = useTeamStore((s) => s.members);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!currentTeam) return;

    setLoading(true);
    try {
      const res = await apiFetch("/api/teams/members/status");
      if (!res.ok) throw new Error(`Failed to fetch members: ${res.status}`);
      const data: OrgMemberStatus[] = await res.json();
      setMembers(data);
    } catch (err) {
      console.error("[useTeamMembers]", err);
    } finally {
      setLoading(false);
    }
  }, [currentTeam, setMembers]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return { members, loading, refetch: fetchMembers };
}
