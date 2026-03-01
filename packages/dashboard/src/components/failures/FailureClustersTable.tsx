import { navigate } from "wouter/use-browser-location";
import type { FailureCluster } from "@devscope/shared";
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

interface FailureClustersTableProps {
  data: FailureCluster[] | null;
  loading: boolean;
}

export function FailureClustersTable({ data, loading }: FailureClustersTableProps) {
  return (
    <ChartCard title="Failure Clusters" loading={loading}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>Developer</TableHead>
            <TableHead className="text-right">Failures</TableHead>
            <TableHead>Session</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).map((cluster, i) => (
            <TableRow
              key={i}
              className="cursor-pointer hover:bg-accent/50"
              onClick={() => {
                navigate(`/session/${cluster.session_id}`);
              }}
            >
              <TableCell className="font-mono text-sm">{cluster.tool_name}</TableCell>
              <TableCell>{cluster.developer_name}</TableCell>
              <TableCell className="text-right">
                <Badge variant="destructive" className="text-[10px]">
                  {cluster.fail_count}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">
                {cluster.session_id.slice(0, 8)}...
              </TableCell>
            </TableRow>
          ))}
          {(!data || data.length === 0) && !loading && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                No failure clusters detected
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ChartCard>
  );
}
