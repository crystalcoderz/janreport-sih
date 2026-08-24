import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Issue = Database["public"]["Tables"]["issues"]["Row"];

// PostgREST caps an unbounded select at its configured max-rows (1000 by
// default) and says nothing about having done so — the response is simply
// shorter than the table. Every consumer of computeCityStats passed the result
// of a plain `select("*")`, so past a thousand reports the analytics page, the
// AI city briefing and the bot's get_city_stats would all have quietly started
// reporting on a slice of the city while presenting it as the whole.
//
// Paged rather than range-capped so the number is right at any size, and
// ordered because paging without an ORDER BY can repeat or skip rows.

const PAGE_SIZE = 1000;
// A city with more than this many reports needs the aggregation pushed into
// SQL, not more pages. The cap stops a runaway loop and says so out loud.
const MAX_PAGES = 50;

export async function fetchAllIssuesForStats(
  supabase: SupabaseClient<Database>
): Promise<{ issues: Issue[]; error: unknown }> {
  const issues: Issue[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("issues")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    // Returned rather than thrown: callers already distinguish "query failed"
    // from "no issues", and rendering zeros for a failed query is the exact
    // confusion this codebase avoids elsewhere.
    if (error) return { issues, error };

    const rows = (data ?? []) as Issue[];
    issues.push(...rows);
    if (rows.length < PAGE_SIZE) return { issues, error: null };
  }

  console.warn(
    `[issues-query] stopped at ${MAX_PAGES * PAGE_SIZE} issues — city stats are now a partial view; move the aggregation into SQL`
  );
  return { issues, error: null };
}
