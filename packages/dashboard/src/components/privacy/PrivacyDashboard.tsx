import { useLocation } from "wouter";
import { Eye, FileText, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { TabBar } from "@/components/ui/tab-bar";
import { ConsentOverview, DataRequestsView } from "./ConsentOverview";
import { EthicsAuditLog } from "./EthicsAuditLog";

type PrivacyTab = "overview" | "requests" | "ethics-log";

function getTabFromPath(pathname: string): PrivacyTab {
  if (pathname.includes("/requests")) return "requests";
  if (pathname.includes("/ethics-log")) return "ethics-log";
  return "overview";
}

export function PrivacyDashboard() {
  const [location, navigate] = useLocation();
  const activeTab = getTabFromPath(location);

  const tabs: { id: PrivacyTab; label: string; icon: typeof Eye }[] = [
    { id: "overview", label: "Overview", icon: Eye },
    { id: "requests", label: "Data Requests", icon: FileText },
    { id: "ethics-log", label: "Ethics Log", icon: ScrollText },
  ];

  const handleTabChange = (tab: PrivacyTab) => {
    const paths: Record<PrivacyTab, string> = {
      overview: "/dashboard/privacy",
      requests: "/dashboard/privacy/requests",
      "ethics-log": "/dashboard/privacy/ethics-log",
    };
    navigate(paths[tab]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy & Ethics"
        description="Data transparency, consent controls, and ethical guardrail monitoring"
      />

      <TabBar tabs={tabs} active={activeTab} onChange={handleTabChange} />

      {activeTab === "overview" && <ConsentOverview />}
      {activeTab === "requests" && <DataRequestsView />}
      {activeTab === "ethics-log" && <EthicsAuditLog />}
    </div>
  );
}
