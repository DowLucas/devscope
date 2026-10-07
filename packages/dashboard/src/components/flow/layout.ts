import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH_DEVELOPER = 200;
const NODE_HEIGHT_DEVELOPER = 90;
const NODE_WIDTH_SESSION = 280;
const NODE_HEIGHT_SESSION = 160;
const NODE_WIDTH_AGENT = 240;
const NODE_HEIGHT_AGENT = 110;
const NODE_HEIGHT_AGENT_SUMMARY = 64;

function getNodeDimensions(type: string): { width: number; height: number } {
  switch (type) {
    case "developer":
      return { width: NODE_WIDTH_DEVELOPER, height: NODE_HEIGHT_DEVELOPER };
    case "agent":
      return { width: NODE_WIDTH_AGENT, height: NODE_HEIGHT_AGENT };
    case "agentSummary":
      return { width: NODE_WIDTH_AGENT, height: NODE_HEIGHT_AGENT_SUMMARY };
    default:
      return { width: NODE_WIDTH_SESSION, height: NODE_HEIGHT_SESSION };
  }
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 80 });

  for (const node of nodes) {
    const { width, height } = getNodeDimensions(node.type ?? "session");
    g.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const { width, height } = getNodeDimensions(node.type ?? "session");
    return {
      ...node,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}
