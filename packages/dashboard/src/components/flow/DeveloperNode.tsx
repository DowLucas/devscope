import { Handle, Position, type NodeProps } from "@xyflow/react";
import { motion } from "motion/react";
import type { DeveloperNodeData } from "./flowTypes";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function DeveloperNode({ data }: NodeProps & { data: DeveloperNodeData }) {
  const { developer, sessionCount } = data;
  const isActive = sessionCount > 0;

  const borderColor = isActive
    ? "rgba(16, 185, 129, 0.6)"  // emerald-500/60
    : "rgba(55, 65, 81, 1)";     // gray-700

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1, borderColor }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="rounded-xl bg-gray-900 px-4 py-3 shadow-lg"
      style={{ width: 200, borderWidth: 2, borderStyle: "solid" }}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            isActive
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-gray-700 text-gray-400"
          }`}
        >
          {getInitials(developer.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-100">
            {developer.name}
          </div>
        </div>
      </div>
      {sessionCount > 0 && (
        <div className="mt-2 text-center">
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
            {sessionCount} active session{sessionCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-600" />
    </motion.div>
  );
}
