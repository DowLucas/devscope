import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { useTeamStore } from "@/stores/teamStore";

export function useTeamInit() {
  const { setCurrentTeam, setCurrentRole, setLoading } = useTeamStore();
  const initRef = useRef(false);

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
      setLoading(false);
      return;
    }
    initRef.current = true;
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
              const member = (org as any).members?.find(
                (m: { userId: string }) => m.userId === sessionUserId
              );
              if (member) setCurrentRole(member.role);
            });
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, [activeOrgId, orgPending, sessionUserId, setCurrentTeam, setCurrentRole, setLoading]);
}
