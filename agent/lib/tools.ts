import { tool } from "ai";
import { z } from "zod";
import { REVIEWS, classifySentiment, type Review } from "./data";

function matchesBank(r: Review, bank?: string) {
  if (!bank) return true;
  return r.bank.toLowerCase().includes(bank.toLowerCase());
}

function withinDays(dateIso: string, days?: number) {
  if (!days) return true;
  const cutoff = Date.now() - days * 86_400_000;
  return new Date(dateIso).getTime() >= cutoff;
}

export const tools = {
  search_feedback: tool({
    description:
      "Full-text search across customer feedback. Use for keyword / topic questions (e.g. 'NEFT', 'ATM', 'home loan'). Returns up to `limit` matching reviews.",
    parameters: z.object({
      query: z.string().describe("Keyword or phrase to search within review text."),
      bank: z.string().optional().describe("Optional bank name filter, e.g. 'HDFC'."),
      sentiment: z
        .enum(["positive", "neutral", "negative"])
        .optional()
        .describe("Optional sentiment filter."),
      days: z.number().int().positive().optional().describe("Restrict to last N days."),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    execute: async ({ query, bank, sentiment, days, limit }) => {
      const q = query.toLowerCase();
      const hits = REVIEWS.filter(
        (r) =>
          matchesBank(r, bank) &&
          withinDays(r.date, days) &&
          r.review_text.toLowerCase().includes(q) &&
          (!sentiment || classifySentiment(r.rating, r.review_text) === sentiment),
      )
        .slice(0, limit)
        .map((r) => ({
          bank: r.bank,
          branch: r.branch,
          rating: r.rating,
          sentiment: classifySentiment(r.rating, r.review_text),
          source: r.source_name,
          date: r.date,
          author: r.author,
          text: r.review_text,
          url: r.url,
        }));
      return { count: hits.length, reviews: hits };
    },
  }),

  sentiment_summary: tool({
    description:
      "Aggregate sentiment counts and average rating per bank. Use for comparison questions ('compare ICICI vs SBI') or overall health checks.",
    parameters: z.object({
      banks: z
        .array(z.string())
        .optional()
        .describe("Optional list of banks to restrict to; default = all."),
      days: z.number().int().positive().optional(),
    }),
    execute: async ({ banks, days }) => {
      const filtered = REVIEWS.filter(
        (r) =>
          withinDays(r.date, days) &&
          (!banks || banks.length === 0 || banks.some((b) => matchesBank(r, b))),
      );
      const byBank = new Map<
        string,
        { positive: number; neutral: number; negative: number; ratings: number[] }
      >();
      for (const r of filtered) {
        const s = classifySentiment(r.rating, r.review_text);
        const row =
          byBank.get(r.bank) ??
          { positive: 0, neutral: 0, negative: 0, ratings: [] };
        row[s] += 1;
        if (r.rating != null) row.ratings.push(r.rating);
        byBank.set(r.bank, row);
      }
      return {
        window_days: days ?? null,
        total_reviews: filtered.length,
        by_bank: Array.from(byBank.entries())
          .map(([bank, v]) => ({
            bank,
            positive: v.positive,
            neutral: v.neutral,
            negative: v.negative,
            total: v.positive + v.neutral + v.negative,
            avg_rating:
              v.ratings.length === 0
                ? null
                : +(
                    v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length
                  ).toFixed(2),
          }))
          .sort((a, b) => b.negative - a.negative),
      };
    },
  }),

  top_complaints: tool({
    description:
      "Return the lowest-rated / most negative reviews, optionally filtered by bank or branch. Use when asked for 'worst', 'top complaints', 'issues to triage'.",
    parameters: z.object({
      bank: z.string().optional(),
      branch: z.string().optional(),
      days: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    execute: async ({ bank, branch, days, limit }) => {
      const rows = REVIEWS.filter(
        (r) =>
          matchesBank(r, bank) &&
          withinDays(r.date, days) &&
          (!branch ||
            (r.branch ?? "").toLowerCase().includes(branch.toLowerCase())) &&
          classifySentiment(r.rating, r.review_text) === "negative",
      )
        .sort((a, b) => (a.rating ?? 5) - (b.rating ?? 5))
        .slice(0, limit)
        .map((r) => ({
          bank: r.bank,
          branch: r.branch,
          rating: r.rating,
          date: r.date,
          source: r.source_name,
          text: r.review_text,
          url: r.url,
        }));
      return { count: rows.length, complaints: rows };
    },
  }),

  branch_hotspots: tool({
    description:
      "Rank branches by volume of negative feedback. Useful for 'which branch has the most 1-star reviews'.",
    parameters: z.object({
      bank: z.string().optional(),
      days: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    execute: async ({ bank, days, limit }) => {
      const counts = new Map<string, { bank: string; branch: string; negatives: number }>();
      for (const r of REVIEWS) {
        if (!matchesBank(r, bank)) continue;
        if (!withinDays(r.date, days)) continue;
        if (classifySentiment(r.rating, r.review_text) !== "negative") continue;
        if (!r.branch) continue;
        const key = `${r.bank}::${r.branch}`;
        const row = counts.get(key) ?? { bank: r.bank, branch: r.branch, negatives: 0 };
        row.negatives += 1;
        counts.set(key, row);
      }
      return {
        hotspots: Array.from(counts.values())
          .sort((a, b) => b.negatives - a.negatives)
          .slice(0, limit),
      };
    },
  }),
};
