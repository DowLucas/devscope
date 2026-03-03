import { Wrench, Zap, TrendingUp, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useSkillStore } from "@/stores/skillStore";

interface MetricCardProps {
  icon: typeof Wrench;
  label: string;
  value: string | number;
  subtitle: string;
  color: string;
}

function MetricCard({ icon: Icon, label, value, subtitle, color }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SkillSummaryCards() {
  const { summary, loading } = useSkillStore();

  if (loading || !summary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 h-24 animate-pulse bg-muted/10" />
          </Card>
        ))}
      </div>
    );
  }

  const personal = summary.personal;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        icon={Wrench}
        label="Tool Mastery"
        value={personal?.tools_used ?? 0}
        subtitle="tools used"
        color="bg-blue-500/15 text-blue-400"
      />
      <MetricCard
        icon={Zap}
        label="Session Quality"
        value={personal ? `${Math.round(personal.recent_quality * 100)}%` : "—"}
        subtitle={`${personal?.recent_sessions ?? 0} recent sessions`}
        color="bg-emerald-500/15 text-emerald-400"
      />
      <MetricCard
        icon={TrendingUp}
        label="Effective Patterns"
        value={summary.patterns.effective_count}
        subtitle={`of ${summary.patterns.total_patterns} total`}
        color="bg-purple-500/15 text-purple-400"
      />
      <MetricCard
        icon={AlertTriangle}
        label="Anti-Patterns"
        value={summary.antiPatterns.critical_count}
        subtitle={`critical (${summary.antiPatterns.warning_count} warnings)`}
        color="bg-amber-500/15 text-amber-400"
      />
    </div>
  );
}
