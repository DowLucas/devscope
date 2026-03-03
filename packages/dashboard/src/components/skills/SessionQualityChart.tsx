import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSkillStore } from "@/stores/skillStore";

export function SessionQualityChart() {
  const { quality } = useSkillStore();

  if (quality.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Session Quality</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center text-sm text-muted-foreground">
          No session quality data yet
        </CardContent>
      </Card>
    );
  }

  const data = quality.map((q) => ({
    week: q.week.slice(5),
    quality: Math.round(q.avg_success_rate * 100),
    sessions: q.sessions,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Session Quality</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
              }}
              formatter={(value, name) => [
                name === "quality" ? `${value}%` : value,
                name === "quality" ? "Success Rate" : "Sessions",
              ]}
            />
            <Line
              type="monotone"
              dataKey="quality"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
