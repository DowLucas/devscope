import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Clock, Wrench, MessageSquare, User, Sparkles, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SessionTurnCard } from "./SessionTurnCard";
import { buildTurns } from "@/lib/buildTurns";
import type { SessionDetail as SessionDetailType, SessionTitle } from "@devscope/shared";
import type { SessionTurn } from "@devscope/shared";
import { parseUTC } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [data, setData] = useState<SessionDetailType | null>(null);
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [titles, setTitles] = useState<SessionTitle[]>([]);
  const [isSelfView, setIsSelfView] = useState(false);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const loading = loadedSessionId !== sessionId;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const currentId = sessionId;
    apiFetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d: SessionDetailType & { isSelfView?: boolean }) => {
        setData(d);
        setTurns(buildTurns(d.events));
        setIsSelfView(d.isSelfView ?? false);
        setLoadedSessionId(currentId);
      })
      .catch(() => setLoadedSessionId(currentId));

    apiFetch(`/api/sessions/${sessionId}/titles`)
      .then((r) => r.json())
      .then((t: SessionTitle[]) => setTitles(t))
      .catch(() => {});
  }, [sessionId]);

  const endTime = data?.session?.endedAt ? parseUTC(data.session.endedAt) : null;
  useEffect(() => {
    if (endTime) return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [endTime]);

  if (loading) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Loading session...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Session not found.
      </div>
    );
  }

  const { session } = data;
  const startTime = parseUTC(session.startedAt);
  const sessionEndTime = session.endedAt ? parseUTC(session.endedAt) : null;
  const durationMs = sessionEndTime ? sessionEndTime.getTime() - startTime.getTime() : now - startTime.getTime();
  const durationMin = Math.round(durationMs / 60000);

  const totalTools = turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
  const totalFails = turns.reduce((sum, t) => sum + t.toolCalls.filter((tc) => tc.success === false).length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">{session.projectName}</h2>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  {session.developerName}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(session as typeof session & { privacyMode?: string }).privacyMode === "private" && (
                  <Badge variant="outline" className="gap-1 text-amber-400 border-amber-400/30">
                    <Lock className="h-3 w-3" />
                    Private
                  </Badge>
                )}
                <Badge
                  variant={session.status === "active" ? "default" : "secondary"}
                  className={session.status === "active" ? "bg-emerald-600" : ""}
                >
                  {session.status}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{durationMin}m</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{turns.length} turns</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{totalTools} tools</span>
              </div>
              <div className="flex items-center gap-2 text-destructive">
                {totalFails > 0 && <span>{totalFails} failures</span>}
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              {startTime.toLocaleString()}
              {endTime && ` - ${endTime.toLocaleString()}`}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {titles.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Session Focus Timeline
            </h3>
            <div className="space-y-2">
              {titles.map((t) => (
                <div key={t.id} className="flex items-baseline gap-3 text-sm">
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(t.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="italic text-gray-300">{t.title}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {titles.length === 0 && data && data.session?.status === "active" && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground">
          Session title generating...
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Conversation ({turns.length} turns)
        </h3>
        {!isSelfView && turns.length > 0 && (
          <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 text-xs text-muted-foreground">
            Prompt text and tool inputs are only visible to the session owner.
            Developers can opt in to detailed sharing via DEVSCOPE_SHARE_DETAILS.
          </div>
        )}
        {turns.map((turn, i) => (
          <SessionTurnCard key={i} turn={turn} index={i} isSelfView={isSelfView} />
        ))}
        {turns.length === 0 && (
          <div className="text-muted-foreground text-center py-8 text-sm">
            No conversation turns recorded.
          </div>
        )}
      </div>
    </div>
  );
}
