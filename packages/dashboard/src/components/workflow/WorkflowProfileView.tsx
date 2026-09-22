import { useEffect, useMemo, useState } from "react";
import { Fingerprint } from "lucide-react";
import { TEAM_INTENT_MIN_DEVELOPERS } from "@devscope/shared";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonGroup, ButtonGroupItem } from "@/components/ui/button-group";
import { useWorkflowProfileStore } from "@/stores/workflowProfileStore";
import { WorkflowRadarChart } from "./WorkflowRadarChart";
import { WorkflowProfileCard } from "./WorkflowProfileCard";
import { buildDimensions, INTENT_LABELS, type ProfileSlice } from "./dimensions";

const ALL = "all";

export function WorkflowProfileView() {
  const { profile, teamSummary, loading, fetchAll } = useWorkflowProfileStore();
  const [intent, setIntent] = useState<string>(ALL);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Intents with a slice, most sessions first.
  const intents = useMemo(
    () =>
      Object.entries(profile?.by_intent ?? {})
        .sort(([, a], [, b]) => b.sessions_analyzed - a.sessions_analyzed)
        .map(([key]) => key),
    [profile],
  );

  const slice: ProfileSlice | null =
    !profile ? null : intent === ALL ? profile : (profile.by_intent?.[intent] ?? profile);
  const activeIntent = intent !== ALL && profile?.by_intent?.[intent] ? intent : ALL;
  const team =
    activeIntent === ALL
      ? teamSummary?.dimension_averages
      : teamSummary?.by_intent?.[activeIntent]?.dimension_averages;
  const dimensions = slice ? buildDimensions(slice, team) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow DNA"
        description="Your personal workflow profile — how you use Claude Code compared to your team"
      />

      {loading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : !profile || !slice ? (
        <div className="text-center py-12">
          <Fingerprint className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium mb-1">No workflow profile yet</h3>
          <p className="text-sm text-muted-foreground">
            Your workflow profile will be generated after enough session data is collected.
          </p>
        </div>
      ) : (
        <>
          {intents.length > 0 && (
            <div className="space-y-2">
              <ButtonGroup>
                <ButtonGroupItem active={activeIntent === ALL} onClick={() => setIntent(ALL)}>
                  All work
                </ButtonGroupItem>
                {intents.map((key) => (
                  <ButtonGroupItem
                    key={key}
                    active={activeIntent === key}
                    onClick={() => setIntent(key)}
                  >
                    {INTENT_LABELS[key] ?? key}
                  </ButtonGroupItem>
                ))}
              </ButtonGroup>
              <p className="text-xs text-muted-foreground">
                {activeIntent === ALL
                  ? "All sessions this week. Pick a kind of work to compare like with like — a debugging-heavy week otherwise reads as a change in style."
                  : !team
                    ? `No team comparison for ${INTENT_LABELS[activeIntent] ?? activeIntent} yet: it appears once ${TEAM_INTENT_MIN_DEVELOPERS} or more developers have enough of these sessions.`
                    : `Only your ${INTENT_LABELS[activeIntent] ?? activeIntent} sessions, against the team's ${INTENT_LABELS[activeIntent] ?? activeIntent} sessions.`}
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <WorkflowRadarChart dimensions={dimensions} showTeam={!!team} />
            <WorkflowProfileCard dimensions={dimensions} sessionsAnalyzed={slice.sessions_analyzed} />
          </div>
        </>
      )}
    </div>
  );
}
