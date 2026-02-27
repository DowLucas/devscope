import { AnimatePresence } from "motion/react";
import { useActivityStore } from "../stores/activityStore";
import { EventCard } from "./EventCard";

export function LiveFeed() {
  const events = useActivityStore((s) => s.events);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Live Activity Feed</h2>
      {events.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          No events yet. Start a Claude Code session with the Groundcontrol plugin enabled.
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
