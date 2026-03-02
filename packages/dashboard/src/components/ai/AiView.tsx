import { useLocation } from "wouter";
import { MessageSquare, Lightbulb, FileText } from "lucide-react";
import { ChatPanel } from "./chat/ChatPanel";
import { AiInsightsFeed } from "./insights/AiInsightsFeed";
import { AiReportsList } from "./reports/AiReportsList";
import { AiReportViewer } from "./reports/AiReportViewer";

type AiTab = "chat" | "insights" | "reports";

function getTabFromPath(pathname: string): { tab: AiTab; reportId?: string } {
  if (pathname.startsWith("/assistant/insights")) return { tab: "insights" };
  if (pathname.startsWith("/assistant/reports/")) {
    const reportId = pathname.replace("/assistant/reports/", "");
    return { tab: "reports", reportId };
  }
  if (pathname.startsWith("/assistant/reports")) return { tab: "reports" };
  return { tab: "chat" };
}

const TABS = [
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "insights" as const, label: "Insights", icon: Lightbulb },
  { id: "reports" as const, label: "Reports", icon: FileText },
];

export function AiView() {
  const [location, navigate] = useLocation();
  const { tab: activeTab, reportId } = getTabFromPath(location);

  const handleTabChange = (tab: AiTab) => {
    const path = tab === "chat" ? "/assistant" : `/assistant/${tab}`;
    navigate(path);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">AI Assistant</h2>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "chat" && <ChatPanel />}
      {activeTab === "insights" && <AiInsightsFeed />}
      {activeTab === "reports" && !reportId && <AiReportsList />}
      {activeTab === "reports" && reportId && (
        <AiReportViewer reportId={reportId} />
      )}
    </div>
  );
}
