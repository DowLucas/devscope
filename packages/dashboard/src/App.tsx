import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { LiveFeed } from "./components/LiveFeed";
import { DeveloperCards } from "./components/DeveloperCards";
import { SessionTimeline } from "./components/SessionTimeline";
import { useGroundcontrolSocket } from "./hooks/useWebSocket";
import { useActivityStore } from "./stores/activityStore";

function App() {
  const [activeView, setActiveView] = useState("feed");
  useGroundcontrolSocket();

  const { setDevelopers, setActiveSessions, setEvents } = useActivityStore();

  useEffect(() => {
    fetch("/api/developers")
      .then((r) => r.json())
      .then(setDevelopers)
      .catch(() => {});

    fetch("/api/sessions/active")
      .then((r) => r.json())
      .then(setActiveSessions)
      .catch(() => {});

    fetch("/api/events/recent?limit=50")
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {});
  }, [setDevelopers, setActiveSessions, setEvents]);

  return (
    <Layout activeView={activeView} onViewChange={setActiveView}>
      {activeView === "feed" && <LiveFeed />}
      {activeView === "developers" && <DeveloperCards />}
      {activeView === "history" && <SessionTimeline />}
    </Layout>
  );
}

export default App;
