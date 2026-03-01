import { $ } from "bun";

const backend = Bun.spawn(["bun", "run", "--hot", "packages/backend/src/index.ts"], {
  stdout: "pipe",
  stderr: "pipe",
});

const dashboard = Bun.spawn(["bun", "run", "--filter", "dashboard", "dev"], {
  stdout: "pipe",
  stderr: "pipe",
});

const prefix = (name: string, color: string) => `${color}[${name}]\x1b[0m`;

async function pipe(stream: ReadableStream<Uint8Array>, label: string) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).trimEnd().split("\n");
    for (const line of lines) {
      console.log(`${label} ${line}`);
    }
  }
}

pipe(backend.stdout, prefix("backend  ", "\x1b[36m"));
pipe(backend.stderr, prefix("backend  ", "\x1b[36m"));
pipe(dashboard.stdout, prefix("dashboard", "\x1b[35m"));
pipe(dashboard.stderr, prefix("dashboard", "\x1b[35m"));

function cleanup() {
  backend.kill();
  dashboard.kill();
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

await Promise.all([backend.exited, dashboard.exited]);
