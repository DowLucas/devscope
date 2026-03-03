import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { apiFetch } from "@/lib/api";
import { PlaybookCard } from "./PlaybookCard";
import { PlaybookDetail } from "./PlaybookDetail";
import type { Playbook } from "@devscope/shared";

export function PlaybooksView() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/playbooks")
      .then((r) => r.json())
      .then((data) => {
        setPlaybooks(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (selectedId) {
    return (
      <PlaybookDetail
        playbookId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playbooks"
        description="Shareable workflow patterns auto-generated from your team's most effective tool usage."
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 rounded-lg animate-pulse bg-muted/10 border border-border"
            />
          ))}
        </div>
      ) : playbooks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No playbooks yet</p>
          <p className="text-sm mt-1">
            Playbooks are auto-generated weekly from your team's most effective patterns.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((pb) => (
            <PlaybookCard
              key={pb.id}
              playbook={pb}
              onClick={() => setSelectedId(pb.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
