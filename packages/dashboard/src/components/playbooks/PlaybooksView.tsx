import { useEffect, useState } from "react";
import type { Playbook } from "@devscope/shared";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { PlaybookCard } from "./PlaybookCard";
import { PlaybookDetail } from "./PlaybookDetail";

export function PlaybooksView() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Playbook | null>(null);

  useEffect(() => {
    apiFetch("/api/playbooks")
      .then((r) => r.json())
      .then((data) => {
        setPlaybooks(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (selected) {
    return <PlaybookDetail playbook={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playbooks"
        description="Shared workflow patterns discovered from your team's most effective sessions"
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[200px]" />
          ))}
        </div>
      ) : playbooks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No playbooks yet. Playbooks are auto-generated weekly from your team's effective workflow patterns.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((pb) => (
            <PlaybookCard
              key={pb.id}
              playbook={pb}
              onClick={() => setSelected(pb)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
