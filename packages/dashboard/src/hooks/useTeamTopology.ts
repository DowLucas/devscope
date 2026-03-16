import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { TeamToolTopology, TeamSkillGap } from "@devscope/shared";

export function useTeamTopology() {
  const [topology, setTopology] = useState<TeamToolTopology[]>([]);
  const [gaps, setGaps] = useState<TeamSkillGap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/topology").then((r) => r.json()),
      apiFetch("/api/topology/gaps").then((r) => r.json()),
    ]).then(([topo, g]) => {
      if (Array.isArray(topo)) setTopology(topo);
      if (Array.isArray(g)) setGaps(g);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return { topology, gaps, loading };
}
