import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface ClaudeMdProject {
  project_name: string;
  project_path: string;
  snapshot_count: number;
}

interface ClaudeMdTimelineEntry {
  snapshot: {
    id: string;
    project_name: string;
    project_path: string;
    content_hash: string;
    content_size: number;
    content_text: string | null;
    session_id: string;
    developer_id: string;
    captured_at: string;
  };
  correlation: {
    sessions_count: number;
    avg_failure_rate: number | null;
    avg_prompt_count: number | null;
    avg_session_duration_min: number | null;
    computed_at: string;
  } | null;
}

export function useClaudeMdProjects() {
  const [projects, setProjects] = useState<ClaudeMdProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/claude-md/projects")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setProjects(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { projects, loading };
}

export function useClaudeMdTimeline(projectPath: string | null) {
  const [timeline, setTimeline] = useState<ClaudeMdTimelineEntry[]>([]);
  const fetchKey = projectPath ?? "";
  const [loadedKey, setLoadedKey] = useState<string>("");
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    const key = fetchKey;
    if (!projectPath) {
      // No project selected — resolve immediately via microtask
      Promise.resolve().then(() => setLoadedKey(key));
      return;
    }
    apiFetch(`/api/claude-md/timeline?project_path=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((entries) => {
        setTimeline(Array.isArray(entries) ? entries : []);
        setLoadedKey(key);
      })
      .catch(() => setLoadedKey(key));
  }, [projectPath, fetchKey]);

  return { timeline, loading };
}
