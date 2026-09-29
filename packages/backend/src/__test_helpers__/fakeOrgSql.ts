/**
 * Minimal tagged-template `sql` fake for org-scoping tests.
 *
 * Rows are filtered the way the real WHERE clause would: a query that mentions
 * `organization_id` only matches rows whose organization_id is among its bound
 * values, and `id = ?` narrows by id. A query that forgets the org filter
 * therefore returns every tenant's rows, which is exactly what a scoping test
 * needs to fail on.
 */
export interface RecordedQuery {
  text: string;
  values: unknown[];
}

export function fakeOrgSql(tables: Record<string, Record<string, unknown>[]>) {
  const queries: RecordedQuery[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    const from = /FROM (\w+)/i.exec(text);
    if (!from || !/^SELECT/i.test(text)) return Promise.resolve([]);
    let rows = tables[from[1]] ?? [];
    if (text.includes("organization_id")) {
      rows = rows.filter((r) => values.includes(r.organization_id));
    }
    if (/\bid = \?/.test(text)) {
      rows = rows.filter((r) => values.includes(r.id));
    }
    return Promise.resolve(rows);
  };
  return Object.assign(sql, { queries }) as unknown as import("bun").SQL & { queries: RecordedQuery[] };
}
