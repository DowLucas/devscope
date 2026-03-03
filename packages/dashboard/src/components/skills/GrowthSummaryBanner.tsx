import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface GrowthSummary {
  overall_trend: "improving" | "stable" | "declining";
  headline: string;
  key_insight: string;
}

interface GrowthSummaryBannerProps {
  data: GrowthSummary;
}

const TREND_CONFIG = {
  improving: {
    icon: TrendingUp,
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-400",
  },
  stable: {
    icon: Minus,
    bg: "bg-blue-500/10 border-blue-500/30",
    text: "text-blue-400",
  },
  declining: {
    icon: TrendingDown,
    bg: "bg-red-500/10 border-red-500/30",
    text: "text-red-400",
  },
} as const;

export function GrowthSummaryBanner({ data }: GrowthSummaryBannerProps) {
  const config = TREND_CONFIG[data.overall_trend];
  const Icon = config.icon;

  return (
    <Card className={`border ${config.bg}`}>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`rounded-lg p-2 ${config.bg}`}>
          <Icon className={`h-6 w-6 ${config.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold">{data.headline}</h3>
          <p className="text-sm text-muted-foreground mt-1">{data.key_insight}</p>
        </div>
      </CardContent>
    </Card>
  );
}
