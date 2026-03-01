import { navigate } from "wouter/use-browser-location";
import type { StuckSession } from "@devscope/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChartCard } from "@/components/insights/ChartCard";

interface StuckSessionAlertsProps {
  sessions: StuckSession[];
  loading: boolean;
}

export function StuckSessionAlerts({ sessions, loading }: StuckSessionAlertsProps) {
  return (
    <ChartCard title="Stuck Sessions" loading={loading}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Developer</TableHead>
            <TableHead>Project</TableHead>
            <TableHead className="text-right">Idle (min)</TableHead>
            <TableHead className="text-right">Fail Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow
              key={s.session_id}
              className="cursor-pointer hover:bg-accent/50"
              onClick={() => {
                navigate(`/session/${s.session_id}`);
              }}
            >
              <TableCell>{s.developer_name}</TableCell>
              <TableCell className="font-mono text-sm">{s.project_name}</TableCell>
              <TableCell className="text-right">
                <Badge
                  variant={s.idle_minutes > 10 ? "destructive" : "secondary"}
                  className="text-[10px]"
                >
                  {Math.round(s.idle_minutes)}m
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {s.tool_failure_rate > 0 ? (
                  <Badge variant="destructive" className="text-[10px]">
                    {(s.tool_failure_rate * 100).toFixed(0)}%
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">0%</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {sessions.length === 0 && !loading && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                No stuck sessions detected
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ChartCard>
  );
}
