import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartCardProps {
  title: string;
  loading?: boolean;
  children: ReactNode;
  action?: ReactNode;
}

export function ChartCard({ title, loading, children, action }: ChartCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
