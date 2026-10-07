import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import type { AgentSummaryNodeData } from "./flowTypes";

export function AgentSummaryNode({ data }: NodeProps & { data: AgentSummaryNodeData }) {
  const { total, types } = data;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 shadow-lg"
      style={{ width: 240 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600" />

      <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        {total} subagent{total !== 1 ? "s" : ""} done
      </div>
      <div className="mt-1 truncate text-xs text-gray-500">
        {types.map((t) => (t.count > 1 ? `${t.agentType} ×${t.count}` : t.agentType)).join(" · ")}
      </div>
    </motion.div>
  );
}
