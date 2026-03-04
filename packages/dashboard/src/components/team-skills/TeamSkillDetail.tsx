import { useState } from "react";
import { Dialog } from "radix-ui";
import { useTeamSkillStore } from "@/stores/teamSkillStore";
import { SkillStatusBadge } from "./SkillStatusBadge";
import { SkillMdPreview } from "./SkillMdPreview";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle,
  RefreshCw,
  Download,
  Archive,
  X,
  Loader2,
  Pencil,
  Save,
  History,
  Link as LinkIcon,
} from "lucide-react";

export function TeamSkillDetail() {
  const {
    selectedSkill,
    refining,
    approveSkill,
    refineSkill,
    exportSkill,
    archiveSkill,
    updateSkill,
    clearSelectedSkill,
  } = useTeamSkillStore();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTriggerPhrases, setEditTriggerPhrases] = useState("");
  const [editBody, setEditBody] = useState("");

  const open = !!selectedSkill;
  const skill = selectedSkill;
  const isRefining = refining === skill?.id;

  function startEditing() {
    if (!skill) return;
    setEditName(skill.name);
    setEditDescription(skill.description);
    setEditTriggerPhrases(skill.trigger_phrases.join(", "));
    setEditBody(skill.skill_body);
    setEditing(true);
  }

  async function saveEdits() {
    if (!skill) return;
    await updateSkill(skill.id, {
      name: editName,
      description: editDescription,
      trigger_phrases: editTriggerPhrases.split(",").map((s) => s.trim()).filter(Boolean),
      skill_body: editBody,
    });
    setEditing(false);
  }

  async function handleExport() {
    if (!skill) return;
    const md = await exportSkill(skill.id);
    if (md) {
      try {
        await navigator.clipboard.writeText(md);
      } catch {
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${skill.name.toLowerCase().replace(/\s+/g, "-")}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  }

  async function handleArchive() {
    if (!skill) return;
    if (window.confirm(`Archive skill "${skill.name}"? This cannot be undone.`)) {
      await archiveSkill(skill.id);
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      clearSelectedSkill();
      setEditing(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] focus:outline-none">
          {skill && (
            <>
              {/* Header */}
              <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Dialog.Title className="text-lg font-semibold truncate">
                    {skill.name}
                  </Dialog.Title>
                  <SkillStatusBadge status={skill.status} />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Edit / Save */}
                  {editing ? (
                    <button
                      onClick={saveEdits}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save
                    </button>
                  ) : (
                    <button
                      onClick={startEditing}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}

                  {/* Approve */}
                  {skill.status === "draft" && (
                    <button
                      onClick={() => approveSkill(skill.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Approve
                    </button>
                  )}

                  {/* Refine */}
                  {(skill.status === "active" || skill.status === "approved") && (
                    <button
                      onClick={() => refineSkill(skill.id)}
                      disabled={isRefining}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      {isRefining ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Refine
                    </button>
                  )}

                  {/* Export */}
                  <button
                    onClick={handleExport}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>

                  {/* Archive */}
                  <button
                    onClick={handleArchive}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>

                  {/* Close */}
                  <Dialog.Close className="inline-flex items-center justify-center rounded-md border p-1.5 hover:bg-accent transition-colors">
                    <X className="h-4 w-4" />
                  </Dialog.Close>
                </div>
              </div>

              {/* Scrollable body */}
              <ScrollArea className="max-h-[70vh]">
                <div className="space-y-6 px-6 py-4">
                  {/* Skill preview / editor */}
                  {editing ? (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Name</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Description</label>
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          Trigger Phrases{" "}
                          <span className="text-muted-foreground font-normal">(comma-separated)</span>
                        </label>
                        <input
                          type="text"
                          value={editTriggerPhrases}
                          onChange={(e) => setEditTriggerPhrases(e.target.value)}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Skill Body</label>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={16}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                        />
                      </div>
                    </div>
                  ) : (
                    <SkillMdPreview skill={skill} />
                  )}

                  {/* Version history */}
                  {skill.versions.length > 1 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-1.5">
                        <History className="h-4 w-4" />
                        Version History
                      </h4>
                      <div className="space-y-1.5">
                        {skill.versions.map((v) => (
                          <div
                            key={v.id}
                            className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                          >
                            <Badge variant="outline" className="text-xs">
                              v{v.version}
                            </Badge>
                            <SkillStatusBadge status={v.status} />
                            <span className="text-muted-foreground text-xs">
                              {new Date(v.created_at).toLocaleDateString()}
                            </span>
                            {v.id === skill.id && (
                              <Badge variant="secondary" className="text-xs ml-auto">
                                current
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Linked patterns */}
                  {skill.links.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-1.5">
                        <LinkIcon className="h-4 w-4" />
                        Linked Patterns
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {skill.links.map((link) => (
                          <Badge key={link.id} variant="outline" className="text-xs">
                            {link.link_type}: {link.pattern_id ?? link.anti_pattern_id}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
