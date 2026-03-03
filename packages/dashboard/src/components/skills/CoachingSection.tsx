import { CoachingCards } from "./CoachingCards";
import { TopPatternsTable } from "./TopPatternsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AiInsights } from "@/stores/skillStore";

interface TopAntiPattern {
  id: string;
  name: string;
  description: string;
  detection_rule: string;
  severity: string;
  suggestion: string;
  team_match_count: number;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  when_to_use: string;
}

interface TopPattern {
  id: string;
  name: string;
  description: string;
  effectiveness: string;
  team_match_count: number;
  avg_success_rate: number;
}

interface CoachingSectionProps {
  topPatterns: TopPattern[];
  coaching: { anti_patterns: TopAntiPattern[]; playbooks: Playbook[] } | null;
  aiCoaching?: AiInsights["coaching"];
  loading: boolean;
}

export function CoachingSection({ topPatterns, coaching, aiCoaching, loading }: CoachingSectionProps) {
  const hasData = topPatterns.length > 0 || (coaching && (coaching.anti_patterns.length > 0 || coaching.playbooks.length > 0));
  const hasAiCoaching = aiCoaching && aiCoaching.length > 0;

  if (!hasData && !hasAiCoaching) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Coaching</h2>

      {hasAiCoaching && <CoachingCards data={aiCoaching!} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopPatternsTable data={topPatterns} loading={loading} />

        {coaching && coaching.anti_patterns.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Anti-Patterns to Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {coaching.anti_patterns.map((ap) => (
                  <div
                    key={ap.id}
                    className="rounded-lg border border-destructive/20 p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium">{ap.name}</p>
                      <Badge variant={ap.severity === "critical" ? "destructive" : "outline"}>
                        {ap.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{ap.suggestion}</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {ap.team_match_count} occurrences
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {coaching && coaching.playbooks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recommended Playbooks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {coaching.playbooks.map((pb) => (
                <div key={pb.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{pb.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{pb.description}</p>
                  <p className="text-xs text-primary/70 mt-1">{pb.when_to_use}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
