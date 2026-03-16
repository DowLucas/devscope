import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Card } from "@/components/ui/card";

interface QualityChartProps {
  entries: Array<{
    snapshot: { captured_at: string; content_hash: string };
    correlation: {
      sessions_count: number;
      avg_failure_rate: number | null;
      avg_prompt_count: number | null;
    } | null;
  }>;
}

export function ClaudeMdQualityChart({ entries }: QualityChartProps) {
  const dataPoints = entries
    .filter((e) => e.correlation)
    .map((e) => ({
      date: new Date(e.snapshot.captured_at).toLocaleDateString(),
      timestamp: new Date(e.snapshot.captured_at).getTime(),
      quality: e.correlation!.avg_failure_rate != null
        ? Math.round((1 - e.correlation!.avg_failure_rate) * 100)
        : null,
      sessions: e.correlation!.sessions_count,
      hash: e.snapshot.content_hash.slice(0, 8),
    }))
    .filter((d) => d.quality != null)
    .reverse();

  if (dataPoints.length < 2) {
    return null;
  }

  // Mark CLAUDE.md changes (hash transitions)
  const changePoints: string[] = [];
  for (let i = 1; i < dataPoints.length; i++) {
    if (dataPoints[i].hash !== dataPoints[i - 1].hash) {
      changePoints.push(dataPoints[i].date);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium mb-4">Session Quality vs CLAUDE.md Changes</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={dataPoints}>
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
          />
          <Area
            type="monotone"
            dataKey="quality"
            name="Quality %"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.1}
          />
          {changePoints.map((date, i) => (
            <ReferenceLine
              key={i}
              x={date}
              stroke="hsl(var(--destructive))"
              strokeDasharray="3 3"
              label={{ value: "Change", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
