import { type ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Users, GitBranch, BarChart3, AlertTriangle, FolderOpen, Sparkles, Clock, Settings, LogOut, UsersRound, Mail, Cog, TrendingUp, BookOpen, Shield, Gauge, Target, Store } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { authClient } from "@/lib/auth-client";
import { useTeamStore } from "@/stores/teamStore";
import { AlertBanner } from "@/components/failures/AlertBanner";

import { Separator } from "@/components/ui/separator";
import logoFull from "@/assets/logo-full.png";

interface LayoutProps {
  children: ReactNode;
}

type BadgeVariant = "success" | "destructive" | "info" | "muted";

interface NavBadge {
  count: number;
  variant: BadgeVariant;
}

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success:     "bg-emerald-500/15 text-emerald-400",
  destructive: "bg-destructive/15 text-destructive",
  info:        "bg-blue-500/15 text-blue-400",
  muted:       "bg-violet-500/15 text-violet-400",
};

function useNavBadges(): Record<string, NavBadge | null> {
  const activeSessions = useActivityStore((s) => s.activeSessions);
  const alerts = useActivityStore((s) => s.alerts);
  const developers = useActivityStore((s) => s.developers);
  const events = useActivityStore((s) => s.events);

  // Tick every 10s so the "last minute" count stays current;
  // also refresh immediately when the tab becomes visible again.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    const onVisible = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Count events from the last 60 seconds
  const oneMinuteAgo = now - 60_000;
  const lastMinuteEventCount = events.filter(
    (e) => new Date(e.timestamp).getTime() > oneMinuteAgo
  ).length;

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;
  const activeDeveloperCount = developers.filter(
    (d) => (d.activeSessions ?? 0) > 0
  ).length;

  return {
    "/dashboard": lastMinuteEventCount > 0
      ? { count: lastMinuteEventCount, variant: "info" } : null,
    "/dashboard/topology": activeSessions.length > 0
      ? { count: activeSessions.length, variant: "success" } : null,
    "/dashboard/sessions": activeSessions.length > 0
      ? { count: activeSessions.length, variant: "info" } : null,
    "/dashboard/incidents": unacknowledgedCount > 0
      ? { count: unacknowledgedCount, variant: "destructive" } : null,
    "/dashboard/developers": activeDeveloperCount > 0
      ? { count: activeDeveloperCount, variant: "muted" } : null,
  };
}

function NavBadgePill({ badge }: { badge: NavBadge }) {
  return (
    <span className={`ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-medium ${BADGE_VARIANT_CLASSES[badge.variant]}`}>
      {badge.count}
    </span>
  );
}

const BASE_NAV_GROUPS = [
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
    ],
  },
  {
    group: "Operations",
    items: [
      { path: "/dashboard/sessions", label: "Sessions", icon: Clock },
      { path: "/dashboard/incidents", label: "Incidents", icon: AlertTriangle },
      { path: "/dashboard/developers", label: "Developers", icon: Users },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { path: "/dashboard/assistant", label: "AI Assistant", icon: Sparkles },
      { path: "/dashboard/skills", label: "Team Skills", icon: TrendingUp },
      { path: "/dashboard/playbooks", label: "Playbooks", icon: BookOpen },
      { path: "/dashboard/marketplace", label: "Marketplace", icon: Store },
      { path: "/dashboard/maturity", label: "Maturity Index", icon: Gauge },
      { path: "/dashboard/benchmarks", label: "Benchmarks", icon: Target },
    ],
  },
];

function isActive(location: string, path: string): boolean {
  if (path === "/dashboard") return location === "/dashboard" || location === "/dashboard/";
  return location === path || location.startsWith(path + "/");
}

const WIDE_VIEWS = ["/dashboard/topology", "/dashboard/metrics", "/dashboard/projects", "/dashboard/incidents", "/dashboard/assistant", "/dashboard/skills", "/dashboard/playbooks", "/dashboard/marketplace", "/dashboard/maturity", "/dashboard/benchmarks", "/dashboard/account", "/dashboard/team", "/dashboard/privacy"];

function useNavGroups() {
  const admin = useTeamStore((s) => s.isAdmin());
  const teamItems = [
    { path: "/dashboard/team", label: "Members", icon: UsersRound },
    { path: "/dashboard/privacy", label: "Privacy", icon: Shield },
    ...(admin
      ? [
          { path: "/dashboard/team/invites", label: "Invites", icon: Mail },
          { path: "/dashboard/team/settings", label: "Team Settings", icon: Cog },
        ]
      : []),
  ];
  return [
    ...BASE_NAV_GROUPS,
    { group: "Team", items: teamItems },
  ];
}

export function Layout({ children }: LayoutProps) {
  const { connected, activeSessions } = useActivityStore();
  const navBadges = useNavBadges();
  const { data: session } = authClient.useSession();
  const { currentTeam } = useTeamStore();
  const [location, setLocation] = useLocation();
  const isWide = WIDE_VIEWS.some((v) => location === v || location.startsWith(v + "/"));
  const navGroups = useNavGroups();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed top-0 left-0 w-52 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border z-40 overflow-y-auto">
        <div className="flex flex-col min-h-full">
          {currentTeam && (
            <div className="px-4 pt-3 pb-1 xl:pt-4 xl:pb-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Team</p>
              <p className="text-sm font-medium truncate">{currentTeam.name}</p>
            </div>
          )}
          <nav className="p-2 xl:p-4 space-y-2 xl:space-y-4 flex-1">
            {navGroups.map((group) => (
              <div key={group.group} className="space-y-0.5 xl:space-y-1">
                <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {group.group}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(location, item.path);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 xl:py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                      {navBadges[item.path] && <NavBadgePill badge={navBadges[item.path]!} />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {session?.user && (
            <div className="shrink-0 border-t border-sidebar-border p-2 xl:p-4 space-y-1 xl:space-y-2">
              <Link
                href="/dashboard/account"
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 xl:py-2 rounded-lg text-sm transition-colors ${
                  isActive(location, "/dashboard/account")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50"
                }`}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              <div className="px-3 py-1 xl:py-2">
                <p className="text-sm font-medium truncate">
                  {session.user.name || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {session.user.email}
                </p>
              </div>
              <button
                onClick={async () => {
                  await authClient.signOut();
                  setLocation("/auth/sign-in");
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 xl:py-2 rounded-lg text-sm text-muted-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="ml-52">
        <header className="shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4 flex items-center justify-between">
          <img src={logoFull} alt="DevScope" className="h-5" />
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? "bg-emerald-400 animate-pulse" : "bg-destructive"
                }`}
              />
              <span className="text-muted-foreground">
                {connected ? "Connected" : "Disconnected"}
              </span>
            </span>
            <span className="text-muted-foreground">
              {activeSessions.length} active
            </span>
          </div>
        </header>
        <Separator />

        <AlertBanner />

        <main className={`p-6 ${isWide ? "" : "max-w-4xl mx-auto"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
