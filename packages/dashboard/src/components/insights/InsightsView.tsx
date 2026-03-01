import { useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import { InsightsOverview } from "./InsightsOverview";
import { DeveloperDrillDown } from "./DeveloperDrillDown";

export function InsightsView() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/insights/developer/:id");
  const selectedDeveloperId = params?.id ?? null;

  const selectDeveloper = useCallback((id: string) => {
    navigate(`/insights/developer/${id}`);
  }, [navigate]);

  const goBack = useCallback(() => {
    navigate("/insights");
  }, [navigate]);

  if (selectedDeveloperId) {
    return (
      <DeveloperDrillDown
        developerId={selectedDeveloperId}
        onBack={goBack}
      />
    );
  }

  return <InsightsOverview onSelectDeveloper={selectDeveloper} />;
}
