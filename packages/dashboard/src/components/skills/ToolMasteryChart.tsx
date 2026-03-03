import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSkillStore } from "@/stores/skillStore";

const TOOL_COLORS = [
  "#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16",
];

export function ToolMasteryChart() {
  const { mastery } = useSkillStore();

  if (mastery.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Tool Mastery</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center text-sm text-muted-foreground">
          No tool mastery data yet
        </CardContent>
      </Card>
    );
  }

  // Pivot: group by week, columns per tool
  const weekMap = new Map<string, Record<string, string | number>>();
  const toolNames = new Set<string>();

  for (const entry of mastery) {
    toolNames.add(entry.tool_name);
    if (!weekMap.has(entry.week)) {
      weekMap.set(entry.week, { week: entry.week });
    }
    weekMap.get(entry.week)![entry.tool_name] = Math.round(entry.success_rate * 100);
  }

  const data = Array.from(weekMap.values()).sort((a, b) =>
    String(a.week).localeCompare(String(b.week))
  );
  const tools = Array.from(toolNames).slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tool Mastery</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => String(v).slice(5)}
            />
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
              formatter={(value) => [`${value}%`]}
            />
            <Legend />
            {tools.map((tool, i) => (
              <Line
                key={tool}
                type="monotone"
                dataKey={tool}
                stroke={TOOL_COLORS[i % TOOL_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
