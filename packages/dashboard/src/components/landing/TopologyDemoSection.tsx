import { useMemo, useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { ReactFlow, Background } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DeveloperNode } from "../flow/DeveloperNode";
import { SessionNode } from "../flow/SessionNode";
import { AgentNode } from "../flow/AgentNode";
import { buildDemoLayout, tickSimulation } from "./demoTopologyData";
import { usePersona } from "./PersonaContext";

const nodeTypes = {
  developer: DeveloperNode,
  session: SessionNode,
  agent: AgentNode,
};

const revealInitial = { opacity: 0, y: 24 } as const;
const revealVisible = { opacity: 1, y: 0 } as const;
const revealViewport = { once: true, amount: 0.2 } as const;

export function TopologyDemoSection() {
  const layout = useMemo(() => buildDemoLayout(), []);
  const [nodes, setNodes] = useState<Node[]>(layout.nodes);
  const edges = layout.edges;
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

  return (
    <section id="topology-demo" className="py-20 px-4">
      <div className="mx-auto max-w-6xl">
        {/* Heading */}
        <motion.div
          initial={revealInitial}
          whileInView={revealVisible}
          viewport={revealViewport}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Visualize your entire team
          </h2>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">
            See every developer, session, and agent in a real-time topology view.
            Spot patterns, catch anti-patterns, and find learning opportunities at a glance.
          </p>
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
            <div className="relative h-[400px] sm:h-[500px] bg-background [&_.react-flow__node]:pointer-events-none">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag
                zoomOnScroll
                zoomOnPinch
                zoomOnDoubleClick={false}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#1f2937" gap={20} />
              </ReactFlow>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
