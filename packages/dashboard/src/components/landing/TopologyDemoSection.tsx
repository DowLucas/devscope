import { useMemo, useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { ReactFlow, Background } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "../flow/nodeTypes";
import { DetailPanel } from "../flow/DetailPanel";
import { FilterToggle } from "../flow/FlowView";
import type { AgentSummaryNodeData } from "../flow/flowTypes";
import { applyDemoView, buildDemoLayout, tickSimulation, type DemoFilters } from "./demoTopologyData";
import { usePersona } from "./PersonaContext";
import { Backdrop } from "./Backdrop";

const revealInitial = { opacity: 0, y: 24 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.2 } as const;

/** What the demo shows off, in the order a visitor meets it on the graph. */
const HIGHLIGHTS = [
  "Branch and task on every card",
  "Your turn, waiting and inactive at a glance",
  "Tool calls and failures, live",
  "Tokens and cost on your own sessions",
  "Click any card for its details",
];

/** Same as the dashboard: a finished-subagents card opens its session. */
function selectionFor(node: Node): string | null {
  if (node.type === "session" || node.type === "agent") return node.id;
  if (node.type === "agentSummary") return `session-${(node.data as AgentSummaryNodeData).sessionId}`;
  return null;
}

export function TopologyDemoSection() {
  const layout = useMemo(() => buildDemoLayout(), []);
  const [nodes, setNodes] = useState<Node[]>(layout.nodes);
  const [filters, setFilters] = useState<DemoFilters>({ hideInactive: false, hideDoneAgents: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { persona } = usePersona();

  // Simulation loop: tick every 1.5–3s (randomized for organic feel)
  const tick = useCallback(() => {
    setNodes((prev) => tickSimulation(prev, persona));
  }, [persona]);

  useEffect(() => {
    // Initial tick after a short delay so the user sees the first state briefly
    const initialTimeout = setTimeout(tick, 800);

    let timer: ReturnType<typeof setTimeout>;
    function scheduleNext() {
      const delay = 1500 + Math.random() * 1500;
      timer = setTimeout(() => {
        tick();
        scheduleNext();
      }, delay);
    }
    scheduleNext();

    return () => {
      clearTimeout(initialTimeout);
      clearTimeout(timer);
    };
  }, [tick]);

  const view = useMemo(() => applyDemoView(nodes, layout.edges, filters), [nodes, layout.edges, filters]);
  const selectedNode = selectedId ? view.nodes.find((n) => n.id === selectedId && !n.hidden) : undefined;
  const shownNodes = useMemo(
    () => view.nodes.map((n) => (n.id === selectedNode?.id ? { ...n, selected: true } : n)),
    [view.nodes, selectedNode?.id],
  );
  const toggle = (key: keyof DemoFilters) => setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <section id="topology-demo" className="relative isolate py-20 px-4">
      <Backdrop
        glows={[
          { color: "blue", at: "15% 60%", size: "35% 45%", opacity: 0.08 },
          { color: "green", at: "85% 40%", size: "35% 45%", opacity: 0.06 },
        ]}
      />
      <div className="mx-auto max-w-6xl">
        {/* Heading */}
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            See every session and subagent, live
          </h2>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">
            One view of what's running across your team: which branch each session is on,
            what each subagent was asked to do, and which sessions are waiting on you.
          </p>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                {h}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Fake window chrome */}
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ delay: 0.15, duration: 0.5, ease: "easeOut" }}
        >
          <div className="overflow-hidden rounded-xl border border-border shadow-2xl shadow-primary/5">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
              <span className="size-3 rounded-full bg-red-500" />
              <span className="size-3 rounded-full bg-yellow-500" />
              <span className="size-3 rounded-full bg-green-500" />
              <span className="ml-3 text-xs text-muted-foreground">
                DevScope — Team Topology
              </span>
              {/* Live indicator */}
              <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                <motion.span
                  className="inline-block h-2 w-2 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
                Live
              </span>
            </div>

            {/* ReactFlow container */}
            <div className="relative h-[460px] sm:h-[560px] bg-background">
              <ReactFlow
                nodes={shownNodes}
                edges={view.edges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedId(selectionFor(node))}
                onPaneClick={() => setSelectedId(null)}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                preventScrolling={false}
                zoomOnDoubleClick={false}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#1f2937" gap={20} />
              </ReactFlow>
              <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2">
                <FilterToggle label="Hide inactive" active={filters.hideInactive} onClick={() => toggle("hideInactive")} />
                <FilterToggle label="Hide finished subagents" active={filters.hideDoneAgents} onClick={() => toggle("hideDoneAgents")} />
              </div>
              {selectedNode ? (
                <DetailPanel
                  node={selectedNode}
                  nodes={view.nodes}
                  onClose={() => setSelectedId(null)}
                  showSessionLink={false}
                />
              ) : null}
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Demo data. Alice is "you": only your own sessions show model, tokens and cost.
            The lock marks a session in private mode.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
