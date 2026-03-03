import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSkillStore } from "@/stores/skillStore";

export function AntiPatternTrendChart() {
  const { antiPatterns } = useSkillStore();

  if (antiPatterns.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Anti-Pattern Trends</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center text-sm text-muted-foreground">
          No anti-pattern data yet
        </CardContent>
      </Card>
    );
  }

  const data = antiPatterns.map((ap) => ({
    week: ap.week.slice(5),
    count: ap.count,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Anti-Pattern Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
              }}
            />
            <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
