import { useEffect, useState } from "react";
import type { MarketplacePlaybook } from "@devscope/shared";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { Download, Star, ArrowLeft } from "lucide-react";

function MarketplaceCard({
  playbook,
  onSelect,
}: {
  playbook: MarketplacePlaybook;
  onSelect: () => void;
}) {
  return (
    <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={onSelect}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-sm font-medium">{playbook.name}</CardTitle>
          {playbook.category && (
            <Badge variant="secondary" className="text-[10px]">
              {playbook.category}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {playbook.description}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {playbook.adoption_count}
          </span>
          {playbook.avg_rating != null && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {playbook.avg_rating.toFixed(1)}
            </span>
          )}
        </div>
        {playbook.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {playbook.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MarketplaceDetail({
  playbook,
  onBack,
}: {
  playbook: MarketplacePlaybook;
  onBack: () => void;
}) {
  const [adopting, setAdopting] = useState(false);
  const [adopted, setAdopted] = useState(false);

  const handleAdopt = async () => {
    setAdopting(true);
    try {
      const res = await apiFetch(`/api/marketplace/playbooks/${playbook.id}/adopt`, {
        method: "POST",
      });
      if (res.ok) setAdopted(true);
    } finally {
      setAdopting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{playbook.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{playbook.description}</p>
            </div>
            <button
              onClick={handleAdopt}
              disabled={adopting || adopted}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {adopted ? "Adopted" : "Adopt Playbook"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-1">When to Use</h4>
            <p className="text-sm text-muted-foreground">{playbook.when_to_use || "No guidance provided"}</p>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-1">Tool Sequence</h4>
            <div className="flex flex-wrap gap-1">
              {playbook.tool_sequence.map((tool, i) => (
                <Badge key={i} variant="outline">{tool}</Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Download className="h-4 w-4" />
              {playbook.adoption_count} adoptions
            </span>
            {playbook.avg_rating != null && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4" />
                {playbook.avg_rating.toFixed(1)} / 5
              </span>
            )}
          </div>

          {playbook.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {playbook.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function MarketplaceView() {
  const [playbooks, setPlaybooks] = useState<MarketplacePlaybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MarketplacePlaybook | null>(null);

  useEffect(() => {
    apiFetch("/api/marketplace/playbooks")
      .then((r) => r.json())
      .then((data) => {
        setPlaybooks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (selected) {
    return <MarketplaceDetail playbook={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playbook Marketplace"
        description="Discover and adopt proven AI workflow strategies from other teams"
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px]" />
          ))}
        </div>
      ) : playbooks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No marketplace playbooks yet. Publish your team's effective workflow patterns to share with others.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((pb) => (
            <MarketplaceCard key={pb.id} playbook={pb} onSelect={() => setSelected(pb)} />
          ))}
        </div>
      )}
    </div>
  );
}
