import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentSummaryNodeData } from "./flowTypes";
import { DetailPanel } from "./DetailPanel";
import { nodeTypes } from "./nodeTypes";
import { useFlowLayout, type FlowFilters } from "./useFlowLayout";
import { useActivityStore } from "@/stores/activityStore";

class FlowErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[calc(100vh-73px)] -m-6 items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-gray-400">Something went wrong rendering the flow map.</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const CLEANUP_INTERVAL_MS = 10_000;
const FILTERS_STORAGE_KEY = "devscope.topology.filters";
const DEFAULT_FILTERS: FlowFilters = { hideInactive: false, hideDoneAgents: false };

/** Filters are a per-viewer convenience; storage may be unavailable. */
function loadFilters(): FlowFilters {
  try {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
    return stored ? { ...DEFAULT_FILTERS, ...(JSON.parse(stored) as Partial<FlowFilters>) } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(filters: FlowFilters): void {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Not remembered this time; the filters still apply.
  }
}

/** The node whose details a click opens: sessions and agents; the done card opens its session. */
function selectionFor(node: Node): string | null {
  if (node.type === "session" || node.type === "agent") return node.id;
  if (node.type === "agentSummary") return `session-${(node.data as AgentSummaryNodeData).sessionId}`;
  return null;
}

export function FlowView() {
  const [filters, setFilters] = useState<FlowFilters>(loadFilters);
  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(filters);
  const toggleFilter = (key: keyof FlowFilters) => {
    const next = { ...filters, [key]: !filters[key] };
    setFilters(next);
    saveFilters(next);
  };
  const connected = useActivityStore((s) => s.connected);
  const cleanupStale = useActivityStore((s) => s.cleanupStale);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Periodically remove ended sessions after a grace period, with their finished agents
  useEffect(() => {
    const id = setInterval(cleanupStale, CLEANUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [cleanupStale]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // The panel follows the node's live data and closes when the node goes away.
  const selectedNode = selectedId ? layoutNodes.find((n) => n.id === selectedId) : undefined;
  const nodes = useMemo(
    () => layoutNodes.map((n) => (n.id === selectedNode?.id ? { ...n, selected: true } : n)),
    [layoutNodes, selectedNode?.id],
  );

  if (layoutNodes.length === 0 && connected) {
    return (
      <div className="flex h-[calc(100vh-73px)] -m-6 items-center justify-center text-gray-500">
        No active sessions. Start a Claude Code session with the DevScope
        plugin to see the flow map.
      </div>
    );
  }

  if (layoutNodes.length === 0) {
    return (
      <div className="flex h-[calc(100vh-73px)] -m-6 items-center justify-center text-gray-500">
        Connecting...
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-73px)] -m-6">
      <FlowErrorBoundary>
        <ReactFlow
          nodes={nodes}
          edges={layoutEdges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => setSelectedId(selectionFor(node))}
          onPaneClick={() => setSelectedId(null)}
          elementsSelectable={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1f2937" gap={20} />
          <Controls
            className="!bg-gray-800 !border-gray-700 !shadow-lg [&>button]:!bg-gray-800 [&>button]:!border-gray-700 [&>button]:!text-gray-400 [&>button:hover]:!bg-gray-700"
          />
          <MiniMap
            className="!bg-gray-900 !border-gray-700"
            nodeColor={(node) => {
              if (node.type === "developer") return "#10b981";
              if (node.type === "agent") return "#a855f7";
              if (node.type === "agentSummary" || node.type === "project") return "#374151";
              return "#6b7280";
            }}
            maskColor="rgba(0, 0, 0, 0.7)"
          />
        </ReactFlow>
        <div className="absolute left-3 top-3 z-10 flex gap-2">
          <FilterToggle label="Hide inactive" active={filters.hideInactive} onClick={() => toggleFilter("hideInactive")} />
          <FilterToggle label="Hide finished subagents" active={filters.hideDoneAgents} onClick={() => toggleFilter("hideDoneAgents")} />
        </div>
        {selectedNode ? (
          <DetailPanel node={selectedNode} nodes={layoutNodes} onClose={() => setSelectedId(null)} />
        ) : null}
      </FlowErrorBoundary>
    </div>
  );
}

export function FilterToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-blue-500/50 bg-blue-500/15 text-blue-300"
          : "border-gray-700 bg-gray-900/80 text-gray-400 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
