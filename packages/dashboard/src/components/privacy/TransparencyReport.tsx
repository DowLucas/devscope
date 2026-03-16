import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { TransparencyReport as TransparencyReportType } from "@devscope/shared";
import { ChartCard } from "@/components/insights/ChartCard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { Shield, Eye, Trash2, Lock } from "lucide-react";

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground))"];

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    sensitive_fields_stripped: "Fields Stripped",
    ai_individual_reference_blocked: "Individual Refs Blocked",
    privacy_mode_activated: "Privacy Mode Activated",
    data_request_processed: "Data Requests Processed",
    retention_purge_executed: "Retention Purges",
  };
  return labels[type] ?? type;
}

export function TransparencyReportView() {
  const [report, setReport] = useState<TransparencyReportType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/ethics/transparency-report?days=30")
      .then((r) => r.json())
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transparency Report" description="Ethics guardrail activity" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <PageHeader title="Transparency Report" />
        <p className="text-muted-foreground text-center py-12">Unable to load transparency report.</p>
      </div>
    );
  }

  const consentPieData = [
    { name: "Sharing Details", value: report.consent_overview.sharing_details },
    { name: "Privacy Mode", value: report.consent_overview.privacy_mode_count },
  ];

  const guardrailData = Object.entries(report.ethics_summary.by_type).map(([type, count]) => ({
    type: eventTypeLabel(type),
    count,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transparency Report"
        description={`Ethics guardrail activity over the last ${report.period_days} days`}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Shield className="h-4 w-4" />
              <span className="text-xs">Total Ethics Events</span>
            </div>
            <div className="text-2xl font-semibold">{report.ethics_summary.total_events}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Eye className="h-4 w-4" />
              <span className="text-xs">Individual Refs Blocked</span>
            </div>
            <div className="text-2xl font-semibold">{report.guardrail_activations.individual_references_blocked}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Lock className="h-4 w-4" />
              <span className="text-xs">Privacy Adoption</span>
            </div>
            <div className="text-2xl font-semibold">{report.privacy_mode_adoption_rate.toFixed(0)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Trash2 className="h-4 w-4" />
              <span className="text-xs">Retention ({report.data_retention.retention_days}d)</span>
            </div>
            <div className="text-2xl font-semibold">{report.data_retention.purges_executed}</div>
            <div className="text-xs text-muted-foreground">purges executed</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Consent Breakdown */}
        <ChartCard title="Consent Breakdown" description={`${report.consent_overview.total_developers} total developers`}>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={consentPieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={5}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {consentPieData.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Guardrail Activations */}
        <ChartCard title="Guardrail Activations" description="Ethics events by type">
          {guardrailData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={guardrailData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="type" width={140} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
              No ethics events recorded in this period
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
