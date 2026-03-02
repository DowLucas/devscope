import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RoiMetricsPanelProps {
  prompts_per_session: number;
  tool_calls_per_session: number;
  sessions_per_developer: number;
  active_days_per_developer: number;
  total_sessions: number;
  total_developers: number;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function RoiMetricsPanel(props: RoiMetricsPanelProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Adoption
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MetricRow label="Total Sessions" value={props.total_sessions.toLocaleString()} />
          <MetricRow label="Active Developers" value={props.total_developers.toLocaleString()} />
          <MetricRow label="Sessions / Developer" value={props.sessions_per_developer.toFixed(1)} />
          <MetricRow label="Active Days / Developer" value={props.active_days_per_developer.toFixed(1)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Efficiency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MetricRow label="Prompts / Session" value={props.prompts_per_session.toFixed(1)} />
          <MetricRow label="Tool Calls / Session" value={props.tool_calls_per_session.toFixed(1)} />
          <MetricRow
            label="Automation Ratio"
            value={
              props.prompts_per_session > 0
                ? (props.tool_calls_per_session / props.prompts_per_session).toFixed(1) + "x"
                : "N/A"
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
