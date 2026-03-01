import { Component, useEffect, type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DeveloperNode } from "./DeveloperNode";
import { SessionNode } from "./SessionNode";
import { AgentNode } from "./AgentNode";
import { useFlowLayout } from "./useFlowLayout";
import { useActivityStore } from "@/stores/activityStore";

const nodeTypes = {
  developer: DeveloperNode,
  session: SessionNode,
  agent: AgentNode,
};

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

export function FlowView() {
  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout();
  const connected = useActivityStore((s) => s.connected);
  const cleanupStale = useActivityStore((s) => s.cleanupStale);

  // Periodically remove ended sessions and stopped agents after grace period
  useEffect(() => {
    const id = setInterval(cleanupStale, CLEANUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [cleanupStale]);

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
    <div className="h-[calc(100vh-73px)] -m-6">
      <FlowErrorBoundary>
        <ReactFlow
          nodes={layoutNodes}
          edges={layoutEdges}
          nodeTypes={nodeTypes}
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
              return "#6b7280";
            }}
            maskColor="rgba(0, 0, 0, 0.7)"
          />
        </ReactFlow>
      </FlowErrorBoundary>
    </div>
  );
}
