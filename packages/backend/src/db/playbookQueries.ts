import type { SQL } from "bun";
import type { Playbook } from "@devscope/shared";
import { sql as Sql } from "bun";

// --- Playbook CRUD ---

export async function createPlaybook(
  sql: SQL,
  orgId: string,
  playbook: {
    name: string;
    description: string;
    tool_sequence: string[];
    when_to_use: string;
    success_metrics?: Record<string, unknown>;
    source_pattern_id?: string;
    created_by?: string;
    status?: string;
  }
): Promise<Playbook> {
  const id = crypto.randomUUID();
  const metrics = playbook.success_metrics ?? {};
  const toolSeq = `{${playbook.tool_sequence.map(t => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

  // A source pattern from another org is dropped rather than linked.
  await sql`
    INSERT INTO playbooks (id, organization_id, name, description, tool_sequence, when_to_use, success_metrics, source_pattern_id, created_by, status)
    VALUES (${id}, ${orgId}, ${playbook.name}, ${playbook.description},
      ${Sql.unsafe(`'${toolSeq.replace(/'/g, "''")}'`)}::TEXT[],
      ${playbook.when_to_use}, ${metrics}::JSONB,
      (SELECT id FROM session_patterns WHERE id = ${playbook.source_pattern_id ?? null} AND organization_id = ${orgId}),
      ${playbook.created_by ?? "auto"},
      ${playbook.status ?? "active"})`;

  const [row] = await sql`SELECT * FROM playbooks WHERE id = ${id}`;
  return row as Playbook;
}

export async function getPlaybooks(
  sql: SQL,
  orgId: string,
  opts?: { status?: string; limit?: number }
): Promise<Playbook[]> {
  const limit = opts?.limit ?? 50;
  const status = opts?.status ?? "active";

  return (await sql`
    SELECT * FROM playbooks
    WHERE organization_id = ${orgId} AND status = ${status}
    ORDER BY created_at DESC
    LIMIT ${limit}`) as Playbook[];
}

export async function getPlaybookById(
  sql: SQL,
  orgId: string,
  id: string
): Promise<Playbook | null> {
  const [row] = await sql`
    SELECT * FROM playbooks WHERE id = ${id} AND organization_id = ${orgId}`;
  return (row as Playbook) ?? null;
}

export async function updatePlaybook(
  sql: SQL,
  orgId: string,
  id: string,
  updates: Partial<{
    name: string;
    description: string;
    when_to_use: string;
    status: string;
  }>
): Promise<Playbook | null> {
  if (updates.name !== undefined) {
    await sql`UPDATE playbooks SET name = ${updates.name}, updated_at = NOW() WHERE id = ${id} AND organization_id = ${orgId}`;
  }
  if (updates.description !== undefined) {
    await sql`UPDATE playbooks SET description = ${updates.description}, updated_at = NOW() WHERE id = ${id} AND organization_id = ${orgId}`;
  }
  if (updates.when_to_use !== undefined) {
    await sql`UPDATE playbooks SET when_to_use = ${updates.when_to_use}, updated_at = NOW() WHERE id = ${id} AND organization_id = ${orgId}`;
  }
  if (updates.status !== undefined) {
    await sql`UPDATE playbooks SET status = ${updates.status}, updated_at = NOW() WHERE id = ${id} AND organization_id = ${orgId}`;
  }
  return getPlaybookById(sql, orgId, id);
}

export async function archivePlaybook(sql: SQL, orgId: string, id: string): Promise<void> {
  await sql`UPDATE playbooks SET status = 'archived', updated_at = NOW() WHERE id = ${id} AND organization_id = ${orgId}`;
}

export async function getPlaybookAdoption(
  sql: SQL,
  orgId: string,
  playbookId: string,
  days: number = 30
): Promise<{ sessions_using: number; avg_success_rate: number }> {
  // A playbook links to a source pattern — count sessions matching that pattern
  const [playbook] = await sql`
    SELECT source_pattern_id FROM playbooks WHERE id = ${playbookId} AND organization_id = ${orgId}`;
  if (!(playbook as any)?.source_pattern_id) {
    return { sessions_using: 0, avg_success_rate: 0 };
  }

  const [stats] = await sql`
    SELECT
      COUNT(*)::INT as sessions_using,
      COALESCE(AVG(tool_success_rate), 0)::FLOAT as avg_success_rate
    FROM session_pattern_matches
    WHERE pattern_id = ${(playbook as any).source_pattern_id}
      AND created_at >= NOW() - make_interval(days => ${days})`;

  return {
    sessions_using: (stats as any)?.sessions_using ?? 0,
    avg_success_rate: Math.round(((stats as any)?.avg_success_rate ?? 0) * 1000) / 1000,
  };
}
