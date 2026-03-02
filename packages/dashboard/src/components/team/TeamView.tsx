import { useState } from "react";
import { useLocation } from "wouter";
import { Users, Mail, Settings, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabBar } from "@/components/ui/tab-bar";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { TeamMembersPage } from "./TeamMembersPage";
import { TeamInvitesPage } from "./TeamInvitesPage";
import { TeamSettingsPage } from "./TeamSettingsPage";
import { InviteDialog } from "./InviteDialog";

type TeamTab = "members" | "invites" | "settings";

function getTabFromPath(pathname: string): TeamTab {
  if (pathname.startsWith("/dashboard/team/invites")) return "invites";
  if (pathname.startsWith("/dashboard/team/settings")) return "settings";
  return "members";
}

export function TeamView() {
  const [location, navigate] = useLocation();
  const activeTab = getTabFromPath(location);
  const isAdmin = useTeamStore((s) => s.isAdmin());
  const currentTeam = useTeamStore((s) => s.currentTeam);
  const { refetch } = useTeamMembers();
  const [inviteOpen, setInviteOpen] = useState(false);

  const tabs: { id: TeamTab; label: string; icon: typeof Users }[] = [
    { id: "members", label: "Members", icon: Users },
    { id: "invites", label: "Invites", icon: Mail },
    ...(isAdmin
      ? [{ id: "settings" as const, label: "Settings", icon: Settings }]
      : []),
  ];

  const handleTabChange = (tab: TeamTab) => {
    const paths: Record<TeamTab, string> = {
      members: "/dashboard/team",
      invites: "/dashboard/team/invites",
      settings: "/dashboard/team/settings",
    };
    navigate(paths[tab]);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description={currentTeam?.name}>
        {isAdmin && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Invite
          </button>
        )}
      </PageHeader>

      <TabBar tabs={tabs} active={activeTab} onChange={handleTabChange} />

      {activeTab === "members" && <TeamMembersPage />}
      {activeTab === "invites" && (
        <TeamInvitesPage onInvite={() => setInviteOpen(true)} />
      )}
      {activeTab === "settings" && <TeamSettingsPage />}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={refetch}
      />
    </div>
  );
}
