import type { SQL } from "bun";
import type { Playbook } from "@devscope/shared";
import { sql as Sql } from "bun";

export async function createPlaybook(sql: SQL, playbook: {
  name: string; description: string; tool_sequence: string[]; when_to_use: string;
  success_metrics?: Record<string, unknown>; source_pattern_id?: string; created_by?: string; status?: string;
}): Promise<Playbook> {
  const id = crypto.randomUUID();
  const metrics = JSON.stringify(playbook.success_metrics ?? {});
  const toolSeq = `{${playbook.tool_sequence.map(t => `"${t}"`).join(",")}}`;
  await sql`INSERT INTO playbooks (id, name, description, tool_sequence, when_to_use, success_metrics, source_pattern_id, created_by, status)
    VALUES (${id}, ${playbook.name}, ${playbook.description}, ${Sql.unsafe(`'${toolSeq}'`)}::TEXT[],
      ${playbook.when_to_use}, ${metrics}::JSONB, ${playbook.source_pattern_id ?? null}, ${playbook.created_by ?? "auto"}, ${playbook.status ?? "active"})`;
  const [row] = await sql`SELECT * FROM playbooks WHERE id = ${id}`;
  return row as Playbook;
}

export async function getPlaybooks(sql: SQL, opts?: { status?: string; limit?: number }): Promise<Playbook[]> {
  const limit = opts?.limit ?? 50;
  const status = opts?.status ?? "active";
  return (await sql`SELECT * FROM playbooks WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`) as Playbook[];
}

export async function getPlaybookById(sql: SQL, id: string): Promise<Playbook | null> {
  const [row] = await sql`SELECT * FROM playbooks WHERE id = ${id}`;
  return (row as Playbook) ?? null;
}

export async function updatePlaybook(sql: SQL, id: string, updates: Partial<{ name: string; description: string; when_to_use: string; status: string }>): Promise<Playbook | null> {
  if (updates.name !== undefined) await sql`UPDATE playbooks SET name = ${updates.name}, updated_at = NOW() WHERE id = ${id}`;
  if (updates.description !== undefined) await sql`UPDATE playbooks SET description = ${updates.description}, updated_at = NOW() WHERE id = ${id}`;
  if (updates.when_to_use !== undefined) await sql`UPDATE playbooks SET when_to_use = ${updates.when_to_use}, updated_at = NOW() WHERE id = ${id}`;
  if (updates.status !== undefined) await sql`UPDATE playbooks SET status = ${updates.status}, updated_at = NOW() WHERE id = ${id}`;
  const [row] = await sql`SELECT * FROM playbooks WHERE id = ${id}`;
  return (row as Playbook) ?? null;
}

export async function archivePlaybook(sql: SQL, id: string): Promise<void> {
  await sql`UPDATE playbooks SET status = 'archived', updated_at = NOW() WHERE id = ${id}`;
}

export async function getPlaybookAdoption(sql: SQL, playbookId: string, days: number = 30): Promise<{ sessions_using: number; avg_success_rate: number }> {
  const [playbook] = await sql`SELECT source_pattern_id FROM playbooks WHERE id = ${playbookId}`;
  if (!(playbook as any)?.source_pattern_id) return { sessions_using: 0, avg_success_rate: 0 };
  const [stats] = await sql`SELECT COUNT(*)::INT as sessions_using, COALESCE(AVG(tool_success_rate), 0)::FLOAT as avg_success_rate
    FROM session_pattern_matches WHERE pattern_id = ${(playbook as any).source_pattern_id} AND created_at >= NOW() - make_interval(days => ${days})`;
  return { sessions_using: (stats as any)?.sessions_using ?? 0, avg_success_rate: Math.round(((stats as any)?.avg_success_rate ?? 0) * 1000) / 1000 };
}
