import { Lightbulb, TrendingUp, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CoachingCard {
  type: "strength" | "improvement" | "action";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  related_metric?: string;
}

interface CoachingCardsProps {
  data: CoachingCard[];
}

const TYPE_CONFIG = {
  strength: {
    icon: TrendingUp,
    border: "border-emerald-500/30",
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    label: "Strength",
  },
  improvement: {
    icon: Lightbulb,
    border: "border-amber-500/30",
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    label: "Improvement",
  },
  action: {
    icon: Zap,
    border: "border-blue-500/30",
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
    label: "Action",
  },
} as const;

const IMPACT_VARIANT = {
  high: "destructive" as const,
  medium: "secondary" as const,
  low: "outline" as const,
};

export function CoachingCards({ data }: CoachingCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.map((card, i) => {
        const config = TYPE_CONFIG[card.type];
        const Icon = config.icon;

        return (
          <Card key={i} className={`border ${config.border}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`rounded-md p-1.5 ${config.iconBg}`}>
                    <Icon className={`h-4 w-4 ${config.iconColor}`} />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {config.label}
                  </span>
                </div>
                <Badge variant={IMPACT_VARIANT[card.impact]}>
                  {card.impact}
                </Badge>
              </div>
              <h4 className="font-medium text-sm mb-1">{card.title}</h4>
              <p className="text-xs text-muted-foreground">{card.description}</p>
              {card.related_metric && (
                <p className="text-xs text-muted-foreground/60 mt-2">
                  Related: {card.related_metric}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
