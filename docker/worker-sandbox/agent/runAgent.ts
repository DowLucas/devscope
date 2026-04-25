// DevScope agent driver — STUB.
//
// Task 5.3 will replace this with the real Claude tool-use loop:
//   - load the candidate's evidence (sessions, patterns, anti-patterns)
//   - construct the kind-specific system prompt
//   - run a bounded Claude conversation with file-edit tools scoped to /work/repo
//   - serialise the resulting unified diff + PR title/body
//
// For Task 3.1 we just echo a deterministic empty draft so the
// pipeline plumbing (entrypoint → agent → verify) can be smoke-tested.

interface Candidate {
    id: string;
    kind: string;
    summary?: string;
}

interface Draft {
    patch: string;
    title: string;
    body: string;
    model: string;
    files_changed: string[];
}

const raw = await Bun.stdin.text();
// Validate input is parseable JSON; fail loudly if not (entrypoint will catch).
const candidate = JSON.parse(raw) as Candidate;

const draft: Draft = {
    patch: "",
    title: "TODO Task 5.3",
    body: `stub draft for candidate ${candidate.id} (kind=${candidate.kind})`,
    model: "stub",
    files_changed: [],
};

process.stdout.write(JSON.stringify(draft));
