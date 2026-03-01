import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AlertRule } from "@devscope/shared";
import { apiFetch } from "@/lib/api";

export function AlertRulesConfig() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [threshold, setThreshold] = useState(3);
  const [windowMin, setWindowMin] = useState(10);
  const [toolName, setToolName] = useState("");

  useEffect(() => {
    apiFetch("/api/alerts/rules")
      .then((r) => r.json())
      .then(setRules)
      .catch(console.error);
  }, []);

  const addRule = async () => {
    const res = await apiFetch("/api/alerts/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threshold,
        window_minutes: windowMin,
        tool_name: toolName || null,
        enabled: true,
      }),
    });
    const rule = await res.json();
    setRules((prev) => [rule, ...prev]);
  };

  const deleteRule = async (id: string) => {
    await apiFetch(`/api/alerts/rules/${id}`, { method: "DELETE" });
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await apiFetch(`/api/alerts/rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Alert Rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Threshold</label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
              min={1}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Window (min)</label>
            <input
              type="number"
              value={windowMin}
              onChange={(e) => setWindowMin(Number(e.target.value))}
              className="w-16 rounded border border-border bg-background px-2 py-1 text-sm"
              min={1}
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">Tool (optional)</label>
            <input
              type="text"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder="All tools"
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={addRule}
            className="flex items-center gap-1 px-3 py-1 rounded bg-accent text-accent-foreground text-sm hover:bg-accent/80"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 px-3 py-2 rounded border border-border text-sm"
            >
              <button
                onClick={() => toggleRule(rule.id, !rule.enabled)}
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  rule.enabled ? "bg-emerald-400" : "bg-muted-foreground"
                }`}
              />
              <span>
                {rule.threshold} failures in {rule.window_minutes}min
              </span>
              {rule.tool_name && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {rule.tool_name}
                </Badge>
              )}
              <button
                onClick={() => deleteRule(rule.id)}
                className="ml-auto text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No alert rules configured</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
