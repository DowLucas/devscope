import type { BurnoutRiskEntry } from "@devscope/shared";
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

interface BurnoutRiskTableProps {
  data: BurnoutRiskEntry[];
}

const RISK_VARIANT: Record<string, "destructive" | "default" | "secondary"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

export function BurnoutRiskTable({ data }: BurnoutRiskTableProps) {
  return (
    <ChartCard title="Burnout Risk Signals">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Developer</TableHead>
            <TableHead className="text-right">Off-Hours %</TableHead>
            <TableHead className="text-right">Weekend Events</TableHead>
            <TableHead className="text-right">Session Spike</TableHead>
            <TableHead>Risk</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((entry) => (
            <TableRow key={entry.developer_id}>
              <TableCell>{entry.developer_name}</TableCell>
              <TableCell className="text-right">
                {(entry.off_hours_ratio * 100).toFixed(0)}%
              </TableCell>
              <TableCell className="text-right">{entry.weekend_events}</TableCell>
              <TableCell className="text-right">
                {entry.session_frequency_spike.toFixed(1)}x
              </TableCell>
              <TableCell>
                <Badge
                  variant={RISK_VARIANT[entry.risk_level]}
                  className="text-[10px]"
                >
                  {entry.risk_level}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No burnout risk signals detected
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ChartCard>
  );
}
