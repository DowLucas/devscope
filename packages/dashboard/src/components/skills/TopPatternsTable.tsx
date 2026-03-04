import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface TopPattern {
  id: string;
  name: string;
  description: string;
  effectiveness: string;
  team_match_count: number;
  avg_success_rate: number;
}

interface TopPatternsTableProps {
  data: TopPattern[];
  loading: boolean;
}

export function TopPatternsTable({ data, loading }: TopPatternsTableProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="h-[200px] rounded-lg bg-muted animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Top Developer Strategies
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.map((pattern) => (
            <div
              key={pattern.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{pattern.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {pattern.description}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge variant="secondary">
                  {pattern.team_match_count} uses
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(pattern.avg_success_rate * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
