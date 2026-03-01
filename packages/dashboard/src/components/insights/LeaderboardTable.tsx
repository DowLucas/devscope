import type { DeveloperLeaderboardEntry } from "@devscope/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartCard } from "./ChartCard";
import { ExportButton } from "@/components/ui/export-button";

interface LeaderboardTableProps {
  data: DeveloperLeaderboardEntry[] | null;
  loading: boolean;
  onSelect: (developerId: string) => void;
  days?: number;
}

export function LeaderboardTable({
  data,
  loading,
  onSelect,
  days,
}: LeaderboardTableProps) {
  return (
    <ChartCard
      title="Developer Leaderboard"
      loading={loading}
      action={<ExportButton dataType="leaderboard" days={days} />}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Developer</TableHead>
            <TableHead className="text-right">Sessions</TableHead>
            <TableHead className="text-right">Prompts</TableHead>
            <TableHead className="text-right">Tool Calls</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map((dev, i) => (
            <TableRow
              key={dev.id}
              className="cursor-pointer hover:bg-accent/50"
              onClick={() => onSelect(dev.id)}
            >
              <TableCell className="font-medium text-muted-foreground">
                {i + 1}
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-medium">{dev.name}</p>
                  <p className="text-xs text-muted-foreground">{dev.email}</p>
                </div>
              </TableCell>
              <TableCell className="text-right">
                {dev.total_sessions}
              </TableCell>
              <TableCell className="text-right">
                {dev.total_prompts}
              </TableCell>
              <TableCell className="text-right">
                {dev.total_tool_calls}
              </TableCell>
            </TableRow>
          ))}
          {(!data || data.length === 0) && !loading && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground py-8"
              >
                No developer activity in the last {days ?? 30} days
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ChartCard>
  );
}
