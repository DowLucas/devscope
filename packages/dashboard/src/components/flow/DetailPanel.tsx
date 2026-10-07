import type { ReactNode } from "react";
import type { Node } from "@xyflow/react";
import { Link } from "wouter";
import { GitBranch, X, ExternalLink, Check } from "lucide-react";
import type { FeedEvent } from "@devscope/shared";
import type { SessionNodeData, AgentNodeData, AgentSummaryNodeData } from "./flowTypes";
import { STATE_CONFIG } from "./sessionStates";
import { EVENT_LABELS, getEventSummary } from "@/lib/eventDisplay";
import { formatCost, formatTokenCount, sessionTokenTotal, timeAgo } from "@/lib/utils";
import { ProjectLabel } from "@/components/ProjectLabel";

interface DetailPanelProps {
  node: Node;
  /** All topology nodes, to list a session's subagents. */
  nodes: Node[];
  onClose: () => void;
}

/** Side panel for the selected topology node; follows its live data. */
export function DetailPanel({ node, nodes, onClose }: DetailPanelProps) {
  return (
    <aside className="absolute right-0 top-0 z-10 flex h-full w-[380px] max-w-full flex-col border-l border-gray-800 bg-gray-950/95 shadow-2xl backdrop-blur">
      <div className="flex justify-end p-2">
        <button
          onClick={onClose}
          className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {node.type === "session" ? (
          <SessionDetails data={node.data as SessionNodeData} nodes={nodes} />
        ) : (
          <AgentDetails data={node.data as AgentNodeData} />
        )}
      </div>
    </aside>
  );
}

function SessionDetails({ data, nodes }: { data: SessionNodeData; nodes: Node[] }) {
  const { session, activityState, lastActivityAt, recentEvents, toolCalls, toolFailures } = data;
  const state = STATE_CONFIG[activityState];
  const agents = nodes.filter(
    (n) => n.type === "agent" && (n.data as AgentNodeData).sessionId === session.id,
  );
  const done = nodes.find(
    (n) => n.type === "agentSummary" && (n.data as AgentSummaryNodeData).sessionId === session.id,
  )?.data as AgentSummaryNodeData | undefined;
  // Usage is only returned for the viewer's own sessions.
  const hasUsage = session.tokenSource != null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <ProjectLabel name={session.projectName} className="truncate text-base font-semibold text-gray-100" />
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${state.badgeClass}`}>
            {state.label}
          </span>
        </div>
        {session.gitBranch ? (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <GitBranch className="h-3 w-3" />
            <span className="truncate font-mono">{session.gitBranch}</span>
          </div>
        ) : null}
        {session.currentTitle ? (
          <p className="text-sm italic text-gray-400">{session.currentTitle}</p>
        ) : null}
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Fact label="Last active">{timeAgo(lastActivityAt)}</Fact>
        <Fact label="Started">{timeAgo(session.startedAt)}</Fact>
        {session.model ? <Fact label="Model">{session.model}</Fact> : null}
        {hasUsage ? (
          <Fact label="Tokens">
            {formatTokenCount(sessionTokenTotal(session))} · {formatCost(session.estimatedCostUsd ?? 0)}
          </Fact>
        ) : null}
        {toolCalls != null ? (
          <Fact label="Tool calls">
            {toolCalls}
            {toolFailures ? <span className="text-red-400"> · {toolFailures} failed</span> : null}
          </Fact>
        ) : null}
      </dl>

      {agents.length > 0 || done ? (
        <Section title="Subagents">
          <ul className="space-y-2">
            {agents.map((n) => {
              const agent = n.data as AgentNodeData;
              return (
                <li key={n.id} className="text-sm">
                  <span className="font-medium text-purple-200">{agent.agentType}</span>
                  {agent.model ? <span className="ml-2 font-mono text-xs text-gray-500">{agent.model}</span> : null}
                  {agent.description ? <div className="truncate text-xs text-gray-400">{agent.description}</div> : null}
                </li>
              );
            })}
            {done ? (
              <li className="flex items-center gap-1.5 text-xs text-gray-400">
                <Check className="h-3 w-3 text-emerald-400" />
                {done.total} done: {done.types.map((t) => `${t.agentType} ×${t.count}`).join(", ")}
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      <RecentActivity events={recentEvents} />

      <FullSessionLink sessionId={session.id} />
    </div>
  );
}

function AgentDetails({ data }: { data: AgentNodeData }) {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold text-purple-200">{data.agentType}</span>
          <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-300">Running</span>
        </div>
        {data.description ? <p className="text-sm text-gray-300">{data.description}</p> : null}
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Fact label="Started">{timeAgo(data.startedAt)}</Fact>
        {data.model ? <Fact label="Model">{data.model}</Fact> : null}
      </dl>

      <RecentActivity events={data.recentEvents} />

      <FullSessionLink sessionId={data.sessionId} />
    </div>
  );
}

function RecentActivity({ events }: { events: FeedEvent[] }) {
  return (
    <Section title="Recent activity">
      {events.length === 0 ? (
        <p className="text-xs text-gray-500">No recent events.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline gap-2 text-xs">
              <span className="w-24 shrink-0 text-gray-500">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
              <span className="min-w-0 flex-1 truncate text-gray-300">{getEventSummary(event)}</span>
              <span className="shrink-0 text-gray-600">{timeAgo(event.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FullSessionLink({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/dashboard/sessions/${sessionId}`}
      className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
    >
      Open full session <ExternalLink className="h-3.5 w-3.5" />
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="truncate text-gray-200">{children}</dd>
    </div>
  );
}
