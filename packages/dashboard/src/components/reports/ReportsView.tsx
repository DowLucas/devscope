import { useLocation } from "wouter";
import { Users, Building2, Crown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabBar } from "@/components/ui/tab-bar";
import { ManagerDashboard } from "./manager/ManagerDashboard";
import { CtoDashboard } from "./cto/CtoDashboard";
import { CeoDashboard } from "./ceo/CeoDashboard";

type ReportTab = "manager" | "cto" | "ceo";

function getTabFromPath(pathname: string): ReportTab {
  if (pathname.startsWith("/briefings/cto")) return "cto";
  if (pathname.startsWith("/briefings/ceo")) return "ceo";
  return "manager";
}

const TABS: { id: ReportTab; label: string; icon: LucideIcon }[] = [
  { id: "manager", label: "Manager", icon: Users },
  { id: "cto", label: "CTO", icon: Building2 },
  { id: "ceo", label: "CEO", icon: Crown },
];

export function ReportsView() {
  const [location, navigate] = useLocation();
  const activeTab = getTabFromPath(location);

  const handleTabChange = (tab: ReportTab) => {
    const path = tab === "manager" ? "/briefings" : `/briefings/${tab}`;
    navigate(path);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Briefings">
        <TabBar tabs={TABS} active={activeTab} onChange={handleTabChange} />
      </PageHeader>

      {activeTab === "manager" && <ManagerDashboard />}
      {activeTab === "cto" && <CtoDashboard />}
      {activeTab === "ceo" && <CeoDashboard />}
    </div>
  );
}
