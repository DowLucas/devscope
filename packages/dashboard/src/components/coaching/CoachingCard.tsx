import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Sparkles, TrendingUp, AlertCircle } from "lucide-react";

export interface CoachingRecommendation {
  type: "strength" | "improvement" | "action";
  title: string;
  body: string;
  impact: "high" | "medium" | "low";
  evidence_session_ids: string[];
}

export interface CoachingCardData {
  id: string;
  developer_id: string;
  week_start: string;
  recommendations: CoachingRecommendation[];
  generated_at: string;
  viewed_at: string | null;
}

const TYPE_CONFIG: Record<
  CoachingRecommendation["type"],
  { label: string; icon: typeof Sparkles; tone: string }
> = {
  strength: { label: "Strength", icon: Sparkles, tone: "text-emerald-400" },
  improvement: { label: "Improve", icon: TrendingUp, tone: "text-amber-400" },
  action: { label: "Try this", icon: AlertCircle, tone: "text-sky-400" },
};

const IMPACT_TONE: Record<CoachingRecommendation["impact"], string> = {
  high: "border-amber-500/40 text-amber-300",
  medium: "border-sky-500/40 text-sky-300",
  low: "border-muted-foreground/30 text-muted-foreground",
};

function Recommendation({ rec }: { rec: CoachingRecommendation }) {
  const [open, setOpen] = useState(false);
  const cfg = TYPE_CONFIG[rec.type];
  const Icon = cfg.icon;
  const hasEvidence = rec.evidence_session_ids.length > 0;

  return (
    <div className="rounded-md border border-border bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-4 shrink-0 ${cfg.tone}`} />
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{rec.title}</span>
            <Badge variant="outline" className={`text-[10px] ${IMPACT_TONE[rec.impact]}`}>
              {cfg.label} · {rec.impact}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{rec.body}</p>
          {hasEvidence && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {rec.evidence_session_ids.length} evidence session
              {rec.evidence_session_ids.length === 1 ? "" : "s"}
            </button>
          )}
          {open && hasEvidence && (
            <ul className="space-y-1 border-l border-border pl-3 text-xs">
              {rec.evidence_session_ids.map((id) => (
                <li key={id}>
                  <Link
                    href={`/dashboard/sessions/${id}`}
                    className="text-primary/80 hover:text-primary"
                  >
                    {id.slice(0, 12)}…
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function CoachingCard({
  card,
  onMarkViewed,
}: {
  card: CoachingCardData;
  onMarkViewed?: (id: string) => void;
}) {
  return (
    <Card className="border-t-2 border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">Week of {card.week_start}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Generated {new Date(card.generated_at).toLocaleString()} · only you can see this
          </p>
        </div>
        {!card.viewed_at && onMarkViewed && (
          <button
            type="button"
            onClick={() => onMarkViewed(card.id)}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            Mark seen
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {card.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recommendations this week.</p>
        ) : (
          card.recommendations.map((rec, i) => (
            <Recommendation key={i} rec={rec} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
