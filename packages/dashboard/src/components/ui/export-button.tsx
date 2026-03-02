import { useState } from "react";
import { Download, ChevronDown } from "lucide-react";

interface ExportButtonProps {
  dataType: string;
  days?: number;
  developerId?: string;
}

export function ExportButton({ dataType, days = 30, developerId }: ExportButtonProps) {
  const [open, setOpen] = useState(false);

  const buildUrl = (format: "csv" | "json") => {
    const params = new URLSearchParams();
    params.set("days", String(days));
    if (developerId) params.set("developerId", developerId);
    return `/api/export/${dataType}/${format}?${params.toString()}`;
  };

  const download = (format: "csv" | "json") => {
    const url = buildUrl(format);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataType}-export.${format}`;
    a.click();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        <Download className="h-3 w-3" />
        Export
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[80px]">
            <button
              onClick={() => download("csv")}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
            >
              CSV
            </button>
            <button
              onClick={() => download("json")}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
            >
              JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}
