import { navigate } from "wouter/use-browser-location";
import type { SessionNeedingAttention as SessionNeedingAttentionType } from "@devscope/shared";
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

interface SessionsNeedingAttentionProps {
  sessions: SessionNeedingAttentionType[];
  loading: boolean;
}

export function SessionsNeedingAttention({ sessions, loading }: SessionsNeedingAttentionProps) {
  return (
    <ChartCard title="Sessions with High Failure Rates" loading={loading}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead className="text-right">Failure Rate</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow
              key={s.session_id}
              className="cursor-pointer hover:bg-accent/50"
              onClick={() => {
                navigate(`/dashboard/sessions/${s.session_id}`);
              }}
            >
              <TableCell className="font-mono text-sm">{s.project_name}</TableCell>
              <TableCell className="text-right">
                <Badge variant="destructive" className="text-[10px]">
                  {(s.tool_failure_rate * 100).toFixed(0)}%
                </Badge>
              </TableCell>
            </TableRow>
          ))}
          {sessions.length === 0 && !loading && (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                No sessions with high failure rates
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ChartCard>
  );
}
