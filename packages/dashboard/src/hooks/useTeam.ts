import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { useTeamStore } from "@/stores/teamStore";
import type { OrgRole } from "@devscope/shared";

export function useTeamInit() {
  const { setCurrentTeam, setCurrentRole, setLoading } = useTeamStore();
  const initRef = useRef(false);
  const fetchingRef = useRef(false);

  const { data: activeOrg, isPending: orgPending } =
    authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();

  const activeOrgId = activeOrg?.id ?? null;
  const sessionUserId = session?.user?.id ?? null;

  useEffect(() => {
    if (orgPending || !sessionUserId) {
      setLoading(true);
      return;
    }

    if (activeOrgId && activeOrg) {
      setCurrentTeam({
        id: activeOrg.id,
        name: activeOrg.name,
        slug: activeOrg.slug,
        logo: activeOrg.logo ?? null,
      });
      const member = activeOrg.members?.find(
        (m: { userId: string }) => m.userId === sessionUserId
      );
      setCurrentRole(member?.role ?? "member");
      setLoading(false);
      initRef.current = true;
      return;
    }

    // No active org — try to set the first available one (only once)
    if (initRef.current) {
      // Don't set loading=false while an async fetch is still in flight
      if (!fetchingRef.current) {
        setLoading(false);
      }
      return;
    }
    initRef.current = true;
    fetchingRef.current = true;
    setLoading(true);

    authClient.organization
      .list()
      .then(({ data }) => {
        if (data && data.length > 0) {
          const org = data[0];
          return authClient.organization
            .setActive({ organizationId: org.id })
            .then(() => {
              setCurrentTeam({
                id: org.id,
                name: org.name,
                slug: org.slug,
                logo: org.logo ?? null,
              });
              const member = (org as { members?: { userId: string; role: OrgRole }[] }).members?.find(
                (m) => m.userId === sessionUserId
              );
              if (member) setCurrentRole(member.role);
            });
        }
      })
      .catch(() => {})
      .finally(() => {
        fetchingRef.current = false;
        setLoading(false);
      });
  }, [activeOrg, activeOrgId, orgPending, sessionUserId, setCurrentTeam, setCurrentRole, setLoading]);
}
