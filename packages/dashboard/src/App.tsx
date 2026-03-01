import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { Layout } from "@/components/Layout";
import { LiveFeed } from "@/components/LiveFeed";
import { DeveloperCards } from "@/components/DeveloperCards";
import { SessionTimeline } from "@/components/SessionTimeline";
import { FlowView } from "@/components/flow/FlowView";
import { InsightsView } from "@/components/insights/InsightsView";
import { SessionDetail } from "@/components/session/SessionDetail";
import { FailuresView } from "@/components/failures/FailuresView";
import { HealthView } from "@/components/health/HealthView";
import { ProjectsView } from "@/components/projects/ProjectsView";
import { AiView } from "@/components/ai/AiView";
import { useDevscopeSocket } from "@/hooks/useWebSocket";
import { useActivityStore } from "@/stores/activityStore";
import { apiFetch } from "@/lib/api";

function App() {
  useDevscopeSocket();

  const { setDevelopers, setActiveSessions, setActiveAgents, setEvents } = useActivityStore();
  const fetchGeneration = useActivityStore((s) => s.fetchGeneration);

  useEffect(() => {
    if (fetchGeneration === 0) return;

    apiFetch("/api/developers")
      .then((r) => r.json())
      .then(setDevelopers)
      .catch(console.error);

    apiFetch("/api/sessions/active")
      .then((r) => r.json())
      .then((sessions: any[]) => {
        const agents = sessions.flatMap((s) => s.activeAgents ?? []);
        setActiveAgents(agents);
        setActiveSessions(sessions);
      })
      .catch(console.error);

    apiFetch("/api/events/recent?limit=50")
      .then((r) => r.json())
      .then(setEvents)
      .catch(console.error);
  }, [fetchGeneration, setDevelopers, setActiveSessions, setActiveAgents, setEvents]);

  return (
    <Layout>
      <Switch>
        <Route path="/developers" component={DeveloperCards} />
        <Route path="/history" component={SessionTimeline} />
        <Route path="/flowmap" component={FlowView} />
        <Route path="/insights/*?" component={InsightsView} />
        <Route path="/session/:id">
          {(params) => <SessionDetail sessionId={params.id} />}
        </Route>
        <Route path="/failures" component={FailuresView} />
        <Route path="/health" component={HealthView} />
        <Route path="/projects/*?" component={ProjectsView} />
        <Route path="/ai/*?" component={AiView} />
        <Route component={LiveFeed} />
      </Switch>
    </Layout>
  );
}

export default App;
