import { Link, useLocation } from "wouter";
import {
  Activity,
  Users,
  GitBranch,
  BarChart3,
  AlertTriangle,
  FolderOpen,
  Sparkles,
  Clock,
  Settings,
  LogOut,
  UsersRound,
  Mail,
  Cog,
  TrendingUp,
  BookOpen,
  FileText,
  Fingerprint,
  Shield,
} from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { authClient } from "@/lib/auth-client";
import { useTeamStore } from "@/stores/teamStore";
import { useState, useEffect } from "react";
import type { LucideIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type BadgeVariant = "success" | "destructive" | "info" | "muted";

interface NavBadge {
  count: number;
  variant: BadgeVariant;
}

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-emerald-500/15 text-emerald-400",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-blue-500/15 text-blue-400",
  muted: "bg-violet-500/15 text-violet-400",
};

function useNavBadges(): Record<string, NavBadge | null> {
  const activeSessions = useActivityStore((s) => s.activeSessions);
  const alerts = useActivityStore((s) => s.alerts);
  const developers = useActivityStore((s) => s.developers);
  const events = useActivityStore((s) => s.events);

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    const onVisible = () => {
      if (!document.hidden) setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const oneMinuteAgo = now - 60_000;
  const lastMinuteEventCount = events.filter(
    (e) => new Date(e.timestamp).getTime() > oneMinuteAgo
  ).length;

  const frictionAlerts = useActivityStore((s) => s.frictionAlerts);
  const unacknowledgedFriction = frictionAlerts.filter(
    (a) => !a.acknowledged
  ).length;
  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;
  const activeDeveloperCount = developers.filter(
    (d) => (d.activeSessions ?? 0) > 0
  ).length;

  return {
    "/dashboard":
      lastMinuteEventCount > 0
        ? { count: lastMinuteEventCount, variant: "info" }
        : null,
    "/dashboard/topology":
      activeSessions.length > 0
        ? { count: activeSessions.length, variant: "success" }
        : null,
    "/dashboard/sessions":
      activeSessions.length > 0
        ? { count: activeSessions.length, variant: "info" }
        : null,
    "/dashboard/incidents":
      unacknowledgedCount + unacknowledgedFriction > 0
        ? {
            count: unacknowledgedCount + unacknowledgedFriction,
            variant: "destructive",
          }
        : null,
    "/dashboard/developers":
      activeDeveloperCount > 0
        ? { count: activeDeveloperCount, variant: "muted" }
        : null,
  };
}

const BASE_NAV_GROUPS: NavGroup[] = [
  {
    group: "Real-Time",
    items: [
      { path: "/dashboard", label: "Activity", icon: Activity },
      { path: "/dashboard/topology", label: "Topology", icon: GitBranch },
    ],
  },
  {
    group: "Analytics",
    items: [
      { path: "/dashboard/metrics", label: "Metrics", icon: BarChart3 },
      { path: "/dashboard/projects", label: "Projects", icon: FolderOpen },
      { path: "/dashboard/claudemd", label: "CLAUDE.md", icon: FileText },
    ],
  },
  {
    group: "Operations",
    items: [
      { path: "/dashboard/sessions", label: "Sessions", icon: Clock },
      {
        path: "/dashboard/incidents",
        label: "Incidents",
        icon: AlertTriangle,
      },
      { path: "/dashboard/developers", label: "Developers", icon: Users },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { path: "/dashboard/assistant", label: "AI Assistant", icon: Sparkles },
      { path: "/dashboard/skills", label: "Team Skills", icon: TrendingUp },
      { path: "/dashboard/playbooks", label: "Playbooks", icon: BookOpen },
      {
        path: "/dashboard/workflow",
        label: "Workflow DNA",
        icon: Fingerprint,
      },
    ],
  },
];

function isActive(location: string, path: string): boolean {
  if (path === "/dashboard")
    return location === "/dashboard" || location === "/dashboard/";
  return location === path || location.startsWith(path + "/");
}

function useNavGroups(): NavGroup[] {
  const admin = useTeamStore((s) => s.isAdmin());
  const teamItems: NavItem[] = [
    { path: "/dashboard/team", label: "Members", icon: UsersRound },
    { path: "/dashboard/privacy", label: "Privacy", icon: Shield },
    ...(admin
      ? [
          { path: "/dashboard/team/invites", label: "Invites", icon: Mail },
          {
            path: "/dashboard/team/settings",
            label: "Team Settings",
            icon: Cog,
          },
        ]
      : []),
  ];
  return [...BASE_NAV_GROUPS, { group: "Team", items: teamItems }];
}

export function AppSidebar() {
  const navBadges = useNavBadges();
  const { data: session } = authClient.useSession();
  const { currentTeam } = useTeamStore();
  const [location, setLocation] = useLocation();
  const navGroups = useNavGroups();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {currentTeam && (
          <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              Team
            </p>
            <p className="text-sm font-medium truncate">{currentTeam.name}</p>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.group}>
            <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(location, item.path);
                  const badge = navBadges[item.path];
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                      >
                        <Link href={item.path}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badge && (
                        <SidebarMenuBadge
                          className={BADGE_VARIANT_CLASSES[badge.variant]}
                        >
                          {badge.count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {session?.user && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(location, "/dashboard/account")}
                tooltip="Settings"
              >
                <Link href="/dashboard/account">
                  <Settings />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-medium truncate">
                  {session.user.name || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {session.user.email}
                </p>
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign out"
                onClick={async () => {
                  await authClient.signOut();
                  setLocation("/auth/sign-in");
                }}
              >
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
