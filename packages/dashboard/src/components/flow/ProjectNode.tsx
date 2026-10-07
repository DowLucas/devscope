import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import { Folder } from "lucide-react";
import type { ProjectNodeData } from "./flowTypes";
import { ProjectLabel } from "@/components/ProjectLabel";

export function ProjectNode({ data }: NodeProps & { data: ProjectNodeData }) {
  const { projectName, sessionCount } = data;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-2 shadow-lg"
      style={{ width: 200 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-600" />
      <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      <ProjectLabel name={projectName} className="min-w-0 flex-1 truncate text-sm font-medium text-gray-200" />
      <span className="shrink-0 text-xs text-gray-500">{sessionCount} sessions</span>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-600" />
    </motion.div>
  );
}
