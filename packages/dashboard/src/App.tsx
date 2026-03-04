import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { AuthProvider } from "@/components/AuthProvider";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { LiveFeed } from "@/components/LiveFeed";
import { DeveloperCards } from "@/components/DeveloperCards";
import { SessionTimeline } from "@/components/SessionTimeline";
import { FlowView } from "@/components/flow/FlowView";
import { InsightsView } from "@/components/insights/InsightsView";
import { SessionDetail } from "@/components/session/SessionDetail";
import { FailuresView } from "@/components/failures/FailuresView";
import { ProjectsView } from "@/components/projects/ProjectsView";
import { AiView } from "@/components/ai/AiView";
import { AuthPage } from "@/components/auth/AuthPage";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { LandingPage } from "@/components/landing/LandingPage";
import { TermsPage } from "@/components/landing/TermsPage";
import { PrivacyPage } from "@/components/landing/PrivacyPage";
import { TeamView } from "@/components/team/TeamView";
import { InviteAcceptPage } from "@/components/team/InviteAcceptPage";
import { SkillsView } from "@/components/skills/SkillsView";
import { PlaybooksView } from "@/components/playbooks/PlaybooksView";
import { useDevscopeSocket } from "@/hooks/useWebSocket";
import { useActivityStore, type ActiveAgent, type ActivityState } from "@/stores/activityStore";
import { apiFetch } from "@/lib/api";
import type { Session } from "@devscope/shared";

function fetchAllData(
  setDevelopers: ActivityState["setDevelopers"],
  setActiveSessions: ActivityState["setActiveSessions"],
  setActiveAgents: ActivityState["setActiveAgents"],
  setEvents: ActivityState["setEvents"],
) {
  apiFetch("/api/developers")
    .then((r) => r.json())
    .then(setDevelopers)
    .catch(console.error);

  apiFetch("/api/sessions/active")
    .then((r) => r.json())
    .then((sessions: (Session & { activeAgents?: ActiveAgent[] })[]) => {
      const agents = sessions.flatMap((s) => s.activeAgents ?? []);
      setActiveAgents(agents);
      setActiveSessions(sessions);
    })
    .catch(console.error);

  apiFetch("/api/events/recent?limit=200")
    .then((r) => r.json())
    .then(setEvents)
    .catch(console.error);
}

function AppContent() {
  useDevscopeSocket();

  const { setDevelopers, setActiveSessions, setActiveAgents, setEvents } = useActivityStore();
  const fetchGeneration = useActivityStore((s) => s.fetchGeneration);

  // Fetch historic data immediately on mount so the dashboard isn't empty
  useEffect(() => {
    fetchAllData(setDevelopers, setActiveSessions, setActiveAgents, setEvents);
  }, [setDevelopers, setActiveSessions, setActiveAgents, setEvents]);

  // Re-fetch when WebSocket (re)connects for fresh data
  useEffect(() => {
    if (fetchGeneration === 0) return;
    fetchAllData(setDevelopers, setActiveSessions, setActiveAgents, setEvents);
  }, [fetchGeneration, setDevelopers, setActiveSessions, setActiveAgents, setEvents]);

  return (
    <Layout>
      <Switch>
        <Route path="/dashboard/developers" component={DeveloperCards} />
        <Route path="/dashboard/sessions/:id">
          {(params) => <SessionDetail sessionId={params.id} />}
        </Route>
        <Route path="/dashboard/sessions" component={SessionTimeline} />
        <Route path="/dashboard/topology" component={FlowView} />
        <Route path="/dashboard/metrics/*?" component={InsightsView} />
        <Route path="/dashboard/incidents" component={FailuresView} />
        <Route path="/dashboard/projects/*?" component={ProjectsView} />
        <Route path="/dashboard/assistant/*?" component={AiView} />
        <Route path="/dashboard/skills/*?" component={SkillsView} />
        <Route path="/dashboard/playbooks/*?" component={PlaybooksView} />
        <Route path="/dashboard/team/*?" component={TeamView} />
        <Route path="/dashboard/account/*?" component={SettingsPage} />
        {/* Default dashboard view — Activity feed */}
        <Route component={LiveFeed} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <AuthProvider>
      <Switch>
        {/* Public landing page at root — no auth required */}
        <Route path="/" component={LandingPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/privacy" component={PrivacyPage} />

        {/* Auth pages — public */}
        <Route path="/auth/:view">
          {(params) => <AuthPage view={params.view} />}
        </Route>

        {/* Invite accept — needs auth check but outside dashboard layout */}
        <Route path="/invite/:token">
          {(params) => <InviteAcceptPage token={params.token} />}
        </Route>

        {/* All dashboard routes go through AuthGuard */}
        <Route path="/dashboard/*?">
          <AuthGuard>
            <AppContent />
          </AuthGuard>
        </Route>

        {/* Onboarding — authed but outside dashboard layout */}
        <Route path="/onboarding">
          <AuthGuard>
            <OnboardingWizard />
          </AuthGuard>
        </Route>
      </Switch>
    </AuthProvider>
  );
}

export default App;
