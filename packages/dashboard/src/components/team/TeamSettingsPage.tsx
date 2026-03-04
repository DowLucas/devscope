import { useCallback, useEffect, useState } from "react";
import { Settings, AlertTriangle, Loader2, Database } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamStore } from "@/stores/teamStore";
import { apiFetch } from "@/lib/api";
import type { OrgSettings } from "@devscope/shared";

export function TeamSettingsPage() {
  const currentTeam = useTeamStore((s) => s.currentTeam);
  const isAdmin = useTeamStore((s) => s.isAdmin());
  const isOwner = useTeamStore((s) => s.isOwner());

  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [thresholdDays, setThresholdDays] = useState(14);
  const [retentionDays, setRetentionDays] = useState(90);
  const [anonymizeOnExpire, setAnonymizeOnExpire] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch("/api/teams/settings");
      if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
      const data: OrgSettings = await res.json();
      setSettings(data);
      setThresholdDays(data.inactive_threshold_days);
      setRetentionDays(data.retention_days ?? 90);
      setAnonymizeOnExpire(data.anonymize_on_expire ?? true);
    } catch (err) {
      console.error("[TeamSettingsPage]", err);
      toast.error("Failed to load team settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function handleSaveThreshold() {
    setSaving(true);
    try {
      const res = await apiFetch("/api/teams/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inactive_threshold_days: thresholdDays }),
      });
      if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
      const updated: OrgSettings = await res.json();
      setSettings(updated);
      setThresholdDays(updated.inactive_threshold_days);
      toast.success("Settings saved");
    } catch (err) {
      console.error("[TeamSettingsPage.saveThreshold]", err);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRetention() {
    setSavingRetention(true);
    try {
      const res = await apiFetch("/api/teams/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retention_days: retentionDays, anonymize_on_expire: anonymizeOnExpire }),
      });
      if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
      const updated: OrgSettings = await res.json();
      setSettings(updated);
      setRetentionDays(updated.retention_days ?? 90);
      setAnonymizeOnExpire(updated.anonymize_on_expire ?? true);
      toast.success("Retention settings saved");
    } catch (err) {
      console.error("[TeamSettingsPage.saveRetention]", err);
      toast.error("Failed to save retention settings");
    } finally {
      setSavingRetention(false);
    }
  }

  function handleDeleteTeam() {
    const confirmed = window.confirm(
      "Are you sure you want to delete this team? This action cannot be undone."
    );
    if (confirmed) {
      toast.info("Team deletion is not yet implemented");
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        You do not have permission to view team settings.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Team Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Team Name
              </label>
              <p className="text-sm font-medium">{currentTeam?.name ?? "-"}</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Slug
              </label>
              <p className="text-sm font-mono text-muted-foreground">
                {currentTeam?.slug ?? "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Inactivity Threshold</CardTitle>
          <CardDescription>
            Developers with no activity for longer than this threshold will be
            flagged as inactive on the Team Members page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor="threshold-days"
                className="text-xs font-medium text-muted-foreground"
              >
                Days
              </label>
              <input
                id="threshold-days"
                type="number"
                min={1}
                max={365}
                value={thresholdDays}
                onChange={(e) =>
                  setThresholdDays(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <button
              onClick={handleSaveThreshold}
              disabled={
                saving || thresholdDays === settings?.inactive_threshold_days
              }
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors inline-flex items-center gap-1.5"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4 text-muted-foreground" />
            Data Retention
          </CardTitle>
          <CardDescription>
            Automatically purge or anonymize event data older than the retention
            period. Anonymized sessions retain aggregate metrics but remove
            developer associations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="retention-days"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Retention Period
                </label>
                <select
                  id="retention-days"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>365 days</option>
                </select>
              </div>
              <button
                onClick={handleSaveRetention}
                disabled={
                  savingRetention ||
                  (retentionDays === (settings?.retention_days ?? 90) &&
                    anonymizeOnExpire === (settings?.anonymize_on_expire ?? true))
                }
                className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors inline-flex items-center gap-1.5"
              >
                {savingRetention && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={anonymizeOnExpire}
                onChange={(e) => setAnonymizeOnExpire(e.target.checked)}
                className="rounded border-input"
              />
              <span className="text-muted-foreground">
                Anonymize expired sessions instead of deleting them
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Deleting the team will permanently remove all team data, members,
              and settings. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <button
              onClick={handleDeleteTeam}
              className="rounded-md border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-2 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              Delete Team
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
