import { useState } from "react";
import { Key, Copy, Check, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useListApiKeys } from "@/hooks/useListApiKeys";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";

const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash";

function getServerUrl() {
  return (
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:6767`
      : window.location.origin)
  );
}

function CopyButton({
  text,
  label = "Copy",
  size = "sm",
}: {
  text: string;
  label?: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  const sizeClasses =
    size === "xs"
      ? "px-2 py-1 text-xs gap-1"
      : "px-3 py-1.5 text-sm gap-1.5";

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center rounded-md border hover:bg-accent transition-colors ${sizeClasses}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}

function SetupSnippet({ apiKey }: { apiKey: string }) {
  const serverUrl = getServerUrl();
  const curlCmd = `curl -X POST ${serverUrl}/api/verify-connection -H "x-api-key: ${apiKey}"`;

  return (
    <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium">Quick setup</p>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            1. Install the plugin
          </p>
          <CopyButton text={INSTALL_COMMAND} label="Copy" size="xs" />
        </div>
        <code className="block rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
          {INSTALL_COMMAND}
        </code>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            2. Test your connection
          </p>
          <CopyButton text={curlCmd} label="Copy" size="xs" />
        </div>
        <code className="block rounded-md border bg-muted px-3 py-2 text-xs font-mono break-all">
          {curlCmd}
        </code>
      </div>

      <p className="text-xs text-muted-foreground">
        When the installer prompts you, enter:{" "}
        <strong>Server URL:</strong>{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">
          {serverUrl}
        </code>
      </p>
    </div>
  );
}

interface ApiKeyInfo {
  id: string;
  name: string | null;
  start: string;
  expiresAt: string | null;
  [key: string]: unknown;
}

function KeyRow({
  apiKey,
  onDelete,
}: {
  apiKey: ApiKeyInfo;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this API key? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await authClient.apiKey.delete({ keyId: apiKey.id });
      onDelete(apiKey.id);
      toast.success("API key deleted");
    } catch {
      toast.error("Failed to delete API key");
    } finally {
      setDeleting(false);
    }
  }

  const expires = apiKey.expiresAt
    ? `Expires ${new Date(apiKey.expiresAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`
    : "Never expires";

  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {apiKey.name || "Untitled"}
          </span>
          <span className="text-sm text-muted-foreground truncate">
            {apiKey.start}******
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{expires}</span>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-50"
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        Delete
      </button>
    </div>
  );
}

export function ApiKeysCard() {
  const { data: apiKeys, isPending, refetch } = useListApiKeys();
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await authClient.apiKey.create({
        name: keyName || undefined,
      });
      const key = (res as { data?: { key?: string } })?.data?.key;
      if (!key) throw new Error("No key returned");
      setCreatedKey(key);
      setShowCreate(false);
      setKeyName("");
      await refetch();
      toast.success("API key created");
    } catch {
      toast.error("Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  function handleDelete() {
    refetch();
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Manage API keys for the DevScope plugin.
          </CardDescription>
        </div>
        {!showCreate && !createdKey && (
          <CardAction>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Key className="h-4 w-4" />
              Create API Key
            </button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Create form */}
        {showCreate && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="new-key-name" className="text-sm font-medium">
                Key name{" "}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="new-key-name"
                type="text"
                placeholder="e.g. My Laptop"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Key className="h-4 w-4" />
                )}
                Generate
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setKeyName("");
                }}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Newly created key display + curl */}
        {createdKey && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span className="text-sm font-medium">API key created</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Your API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
                  {createdKey}
                </code>
                <CopyButton text={createdKey} label="Copy" />
              </div>
              <p className="text-xs text-amber-500 dark:text-amber-400">
                This key is only shown once. Copy it now.
              </p>
            </div>

            <SetupSnippet apiKey={createdKey} />

            <button
              onClick={() => setCreatedKey(null)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* Existing keys list */}
        {isPending ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading keys...</span>
          </div>
        ) : apiKeys && apiKeys.length > 0 ? (
          <div className="space-y-2">
            {apiKeys.map((key) => (
              <KeyRow key={key.id} apiKey={key} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          !createdKey && (
            <p className="text-sm text-muted-foreground py-2">
              No API keys yet. Create one to connect the DevScope plugin.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
