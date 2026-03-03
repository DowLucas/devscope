import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSkillStore } from "@/stores/skillStore";

export function PatternAdoptionChart() {
  const { patterns } = useSkillStore();

  if (patterns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pattern Adoption</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center text-sm text-muted-foreground">
          No pattern adoption data yet
        </CardContent>
      </Card>
    );
  }

  const data = patterns.map((p) => ({
    week: p.week.slice(5),
    Effective: p.effective_count,
    Neutral: p.neutral_count,
    Ineffective: p.ineffective_count,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Pattern Adoption</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="Effective"
              stackId="1"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.3}
            />
            <Area
              type="monotone"
              dataKey="Neutral"
              stackId="1"
              stroke="#6b7280"
              fill="#6b7280"
              fillOpacity={0.3}
            />
            <Area
              type="monotone"
              dataKey="Ineffective"
              stackId="1"
              stroke="#ef4444"
              fill="#ef4444"
              fillOpacity={0.3}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
