import { DeveloperNode } from "./DeveloperNode";
import { SessionNode } from "./SessionNode";
import { AgentNode } from "./AgentNode";
import { AgentSummaryNode } from "./AgentSummaryNode";

/** Node components of the topology graph, shared by the dashboard and the landing demo. */
export const nodeTypes = {
  developer: DeveloperNode,
  session: SessionNode,
  agent: AgentNode,
  agentSummary: AgentSummaryNode,
};
