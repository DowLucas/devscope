import type { OrgMemberStatus } from "@devscope/shared";

interface MemberStatusBadgeProps {
  member: OrgMemberStatus;
}

function getStatus(member: OrgMemberStatus): {
  label: string;
  className: string;
} {
  if (!member.has_dashboard_account) {
    return {
      label: "Pending",
      className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    };
  }

  if (member.has_dashboard_account && !member.onboarding_complete) {
    return {
      label: "Onboarding",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    };
  }

  if (!member.has_active_api_key && member.has_dashboard_account) {
    return {
      label: "No API Key",
      className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    };
  }

  if (member.is_inactive && member.onboarding_complete) {
    return {
      label: "Inactive",
      className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    };
  }

  if (
    member.has_dashboard_account &&
    member.onboarding_complete &&
    !member.is_inactive
  ) {
    return {
      label: "Active",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    };
  }

  return {
    label: "Unknown",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
}

export function MemberStatusBadge({ member }: MemberStatusBadgeProps) {
  const { label, className } = getStatus(member);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
