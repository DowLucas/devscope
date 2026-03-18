import { useState } from "react";
import { Check, X, MoreVertical, Users, UserCheck, UserX, Clock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useTeamStore } from "@/stores/teamStore";
import { authClient } from "@/lib/auth-client";
import { MemberStatusBadge } from "./MemberStatusBadge";
import type { OrgMemberStatus, OrgRole } from "@devscope/shared";

function timeAgo(date: string | null): string {
  if (!date) return "Never";
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function RoleBadge({ role }: { role: OrgRole }) {
  const styles: Record<OrgRole, string> = {
    owner:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
    admin:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    member:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[role]}`}
    >
      {role}
    </span>
  );
}

function MemberActions({
  member,
  onUpdated,
}: {
  member: OrgMemberStatus;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const currentTeam = useTeamStore((s) => s.currentTeam);
  const isCurrentOwner = useTeamStore((s) => s.isOwner());

  if (!member.auth_user_id || member.role === "owner") return null;

  async function changeRole(newRole: OrgRole) {
    if (!currentTeam || !member.auth_user_id) return;
    setOpen(false);
    try {
      const { error } = await authClient.organization.updateMemberRole({
        memberId: member.auth_user_id,
        role: newRole,
        organizationId: currentTeam.id,
      });
      if (error) {
        toast.error(error.message ?? "Failed to update role");
        return;
      }
      toast.success(`${member.developer_name} is now ${newRole}`);
      onUpdated();
    } catch (err) {
      console.error("[MemberActions.changeRole]", err);
      toast.error("An unexpected error occurred");
    }
  }

  async function removeMember() {
    if (!currentTeam || !member.auth_user_id) return;
    setOpen(false);

    const confirmed = window.confirm(
      `Remove ${member.developer_name} from the team?`
    );
    if (!confirmed) return;

    try {
      const { error } = await authClient.organization.removeMember({
        memberIdOrEmail: member.auth_user_id,
        organizationId: currentTeam.id,
      });
      if (error) {
        toast.error(error.message ?? "Failed to remove member");
        return;
      }
      toast.success(`${member.developer_name} has been removed`);
      onUpdated();
    } catch (err) {
      console.error("[MemberActions.removeMember]", err);
      toast.error("An unexpected error occurred");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded hover:bg-accent transition-colors"
      >
        <MoreVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-44 rounded-md border bg-popover text-popover-foreground shadow-md py-1">
            {member.role !== "admin" && (
              <button
                onClick={() => changeRole("admin")}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
              >
                Make Admin
              </button>
            )}
            {member.role === "admin" && (
              <button
                onClick={() => changeRole("member")}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
              >
                Make Member
              </button>
            )}
            {isCurrentOwner && (
              <button
                onClick={removeMember}
                className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function TeamMembersPage() {
  const { members, loading, refetch } = useTeamMembers();
  const isAdmin = useTeamStore((s) => s.isAdmin());

  const totalCount = members.length;
  const activeCount = members.filter(
    (m) => !m.is_inactive && m.onboarding_complete && m.has_dashboard_account
  ).length;
  const inactiveCount = members.filter((m) => m.is_inactive).length;
  const pendingCount = members.filter(
    (m) => !m.has_dashboard_account || (!m.onboarding_complete && !m.is_inactive)
  ).length;

  if (loading && members.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Members" value={totalCount} icon={Users} />
        <MetricCard label="Active" value={activeCount} icon={UserCheck} />
        <MetricCard label="Inactive" value={inactiveCount} icon={UserX} />
        <MetricCard label="Pending" value={pendingCount} icon={Clock} />
      </div>

      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  Developer
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  Role
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">
                  API Key
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                  Last Activity
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  Sessions
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                  Events
                </th>
                {isAdmin && (
                  <th className="w-10 px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberRow
                  key={m.developer_id}
                  member={m}
                  showActions={isAdmin}
                  onUpdated={refetch}
                />
              ))}
              {members.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 8 : 7}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function MemberRow({
  member,
  showActions,
  onUpdated,
}: {
  member: OrgMemberStatus;
  showActions: boolean;
  onUpdated: () => void;
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div>
          <p className="font-medium text-foreground flex items-center gap-1.5">
            {member.developer_name}
            {(member.linked_email_count ?? 0) > 1 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                {member.linked_email_count} emails
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {member.developer_email}
          </p>
        </div>
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={member.role} />
      </td>
      <td className="px-4 py-3">
        <MemberStatusBadge member={member} />
      </td>
      <td className="px-4 py-3 text-center">
        {member.has_active_api_key ? (
          <Check className="h-4 w-4 text-emerald-500 mx-auto" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {timeAgo(member.last_activity)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {member.total_sessions.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {member.total_events.toLocaleString()}
      </td>
      {showActions && (
        <td className="px-4 py-3">
          <MemberActions member={member} onUpdated={onUpdated} />
        </td>
      )}
    </tr>
  );
}
