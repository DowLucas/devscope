import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DataSharingCard() {
  const [shareDetails, setShareDetails] = useState(false);
  const [linked, setLinked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await apiFetch("/api/privacy/consent/preferences");
      if (!res.ok) throw new Error();
      const data = await res.json() as { linked: boolean; share_details: boolean };
      setLinked(data.linked);
      setShareDetails(data.share_details);
    } catch {
      // silently leave defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  async function handleToggle(value: boolean) {
    setSaving(true);
    try {
      const res = await apiFetch("/api/privacy/consent/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_details: value }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = "Failed to update";
        try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* non-JSON */ }
        throw new Error(msg);
      }
      setShareDetails(value);
      toast.success(value ? "Detail sharing enabled" : "Detail sharing disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update preference");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Data Sharing</CardTitle>
        </div>
        <CardDescription>
          Control whether detailed session data (prompt text, tool inputs, response text) is visible
          in your personal session views.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading preferences…</span>
          </div>
        ) : !linked ? (
          <p className="text-sm text-muted-foreground">
            No developer identity linked yet. Run the DevScope plugin at least once to link your
            account.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Share session details (opt-in)</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  When enabled, prompt text, tool inputs, and response text are retained in your
                  session views. This data is never shared with other team members.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={shareDetails}
                disabled={saving}
                onClick={() => handleToggle(!shareDetails)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                  shareDetails ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    shareDetails ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Always collected (no opt-in required)
              </p>
              <div className="flex flex-wrap gap-2">
                {["Session metadata", "Event types", "Tool names", "Prompt length", "Developer identity"].map((cat) => (
                  <span key={cat} className="rounded-md bg-muted px-2 py-0.5 text-xs">{cat}</span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Opt-in required
              </p>
              <div className="flex flex-wrap gap-2">
                {["Prompt text", "Tool inputs", "Response text"].map((cat) => (
                  <span
                    key={cat}
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      shareDetails
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
