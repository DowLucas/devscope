import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Search } from "lucide-react";
import type { SearchField, SearchMode, SearchResponse } from "@devscope/shared";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TabBar } from "@/components/ui/tab-bar";
import { apiFetch } from "@/lib/api";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { SearchResultCard } from "./SearchResultCard";

type Range = "7d" | "30d" | "90d" | "all";
const RANGE_DAYS: Record<Range, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

const MODES: { id: SearchMode; label: string }[] = [
  { id: "hybrid", label: "Smart" },
  { id: "keyword", label: "Exact" },
  { id: "semantic", label: "Meaning" },
];

const FIELDS: { id: SearchField; label: string }[] = [
  { id: "both", label: "Everything" },
  { id: "prompt", label: "My prompts" },
  { id: "response", label: "Claude's replies" },
];

const selectClass = "rounded-md border border-input bg-background px-3 py-1.5 text-sm";

export function SearchPage() {
  const [, navigate] = useLocation();
  const initialQuery = new URLSearchParams(useSearch()).get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [field, setField] = useState<SearchField>("both");
  const [project, setProject] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [allOrigins, setAllOrigins] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebouncedValue(query.trim(), 300);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/similar/search/projects")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d?.projects)) setProjects(d.projects);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep ?q= in the URL so a search can be bookmarked or shared.
  useEffect(() => {
    navigate(debounced ? `/dashboard/search?q=${encodeURIComponent(debounced)}` : "/dashboard/search", {
      replace: true,
    });
  }, [debounced, navigate]);

  const requestKey = useMemo(() => {
    if (!debounced) return null;
    const params = new URLSearchParams({ q: debounced, mode, field, limit: "30" });
    if (project) params.set("project", project);
    if (range !== "all") params.set("range", range);
    if (allOrigins) params.set("all_origins", "true");
    return params.toString();
  }, [debounced, mode, field, project, range, allOrigins]);

  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    // The range becomes an absolute `from` only when the request is sent.
    const params = new URLSearchParams(requestKey);
    const days = RANGE_DAYS[(params.get("range") ?? "all") as Range];
    params.delete("range");
    if (days !== null) params.set("from", new Date(Date.now() - days * 86_400_000).toISOString());
    apiFetch(`/api/similar/search?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 429 ? "Too many searches, try again in a minute." : "Search failed.");
        return (await r.json()) as SearchResponse;
      })
      .then((d) => {
        if (cancelled) return;
        setResponse(d);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const loading = requestKey !== null && loadedKey !== requestKey;
  const results = response?.results ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search"
        description="Find anything from your past Claude Code sessions: your prompts and Claude's replies. Matches exact terms and meaning."
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search sessions… e.g. caddy basic auth, "exact phrase", -exclude'
          className="h-12 pl-11 text-base md:text-base"
          aria-label="Search sessions"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TabBar tabs={MODES} active={mode} onChange={setMode} />
        <TabBar tabs={FIELDS} active={field} onChange={setField} />
        <select value={project} onChange={(e) => setProject(e.target.value)} className={selectClass} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value as Range)} className={selectClass} aria-label="Time range">
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={allOrigins} onChange={(e) => setAllOrigins(e.target.checked)} />
          Include automated prompts
        </label>
      </div>

      {response && !response.semanticAvailable && mode !== "keyword" && (
        <p className="text-xs text-muted-foreground">
          Meaning search is unavailable right now, so these are exact matches only.
        </p>
      )}

      {!requestKey ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Type to search. Use quotes for an exact phrase, <code>OR</code> for alternatives and <code>-word</code> to exclude.
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No matching turns. Try fewer words, or switch to Meaning.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map((hit) => (
            <SearchResultCard key={hit.turnId} hit={hit} />
          ))}
        </div>
      )}
    </div>
  );
}
