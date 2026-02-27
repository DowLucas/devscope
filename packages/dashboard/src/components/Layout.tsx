import { type ReactNode } from "react";
import { useActivityStore } from "../stores/activityStore";

interface LayoutProps {
  children: ReactNode;
  activeView: string;
  onViewChange: (view: string) => void;
}

export function Layout({ children, activeView, onViewChange }: LayoutProps) {
  const { connected, activeSessions } = useActivityStore();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Groundcontrol</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"
              }`}
            />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <span className="text-gray-400">
            {activeSessions.length} active
          </span>
        </div>
      </header>

      <div className="flex">
        <nav className="w-48 border-r border-gray-800 p-4 space-y-1">
          {[
            { id: "feed", label: "Live Feed" },
            { id: "developers", label: "Developers" },
            { id: "history", label: "History" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeView === item.id
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800/50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
