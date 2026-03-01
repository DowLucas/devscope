import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Users, Clock, GitBranch, BarChart3, AlertTriangle, Heart, FolderOpen, Sparkles } from "lucide-react";
import { useActivityStore } from "@/stores/activityStore";
import { AlertBanner } from "@/components/failures/AlertBanner";

interface LayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { path: "/", label: "Live Feed", icon: Activity },
  { path: "/developers", label: "Developers", icon: Users },
  { path: "/history", label: "History", icon: Clock },
  { path: "/flowmap", label: "Flow Map", icon: GitBranch },
  { path: "/insights", label: "Insights", icon: BarChart3 },
  { path: "/failures", label: "Failures", icon: AlertTriangle },
  { path: "/health", label: "Health", icon: Heart },
  { path: "/projects", label: "Projects", icon: FolderOpen },
  { path: "/ai", label: "AI Intelligence", icon: Sparkles },
];

function isActive(location: string, path: string): boolean {
  if (path === "/") return location === "/";
  return location === path || location.startsWith(path + "/");
}

const WIDE_VIEWS = ["/flowmap", "/insights", "/health", "/projects", "/failures", "/ai"];

export function Layout({ children }: LayoutProps) {
  const { connected, activeSessions } = useActivityStore();
  const [location] = useLocation();
  const isWide = WIDE_VIEWS.some((v) => location === v || location.startsWith(v + "/"));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">DevScope</h1>
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

      <AlertBanner />

      <div className="flex">
        <nav className="w-52 border-r border-border p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(location, item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-accent-foreground hover:bg-accent/50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className={`flex-1 p-6 ${isWide ? "" : "max-w-4xl"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
