import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { useActivityStore } from "@/stores/activityStore";
import { AlertBanner } from "@/components/failures/AlertBanner";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import logoFull from "@/assets/logo-full.png";

interface LayoutProps {
  children: ReactNode;
}

const WIDE_VIEWS = [
  "/dashboard/topology",
  "/dashboard/metrics",
  "/dashboard/projects",
  "/dashboard/claudemd",
  "/dashboard/incidents",
  "/dashboard/assistant",
  "/dashboard/skills",
  "/dashboard/playbooks",
  "/dashboard/workflow",
  "/dashboard/account",
  "/dashboard/team",
  "/dashboard/privacy",
];

export function Layout({ children }: LayoutProps) {
  const { connected, activeSessions } = useActivityStore();
  const [location] = useLocation();
  const isWide = WIDE_VIEWS.some(
    (v) => location === v || location.startsWith(v + "/")
  );

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 py-3 flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <img src={logoFull} alt="DevScope" className="h-5" />
          <div className="ml-auto flex items-center gap-4 text-sm">
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
      </SidebarInset>
    </SidebarProvider>
  );
}
