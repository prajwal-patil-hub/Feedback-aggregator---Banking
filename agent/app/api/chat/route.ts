import { google } from "@ai-sdk/google";
import { streamText, convertToCoreMessages } from "ai";
import { tools } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a bank-feedback insights analyst for Indian retail banks.
Available data: aggregated customer reviews across HDFC, ICICI, SBI, Axis, and Kotak,
sourced from Google Maps, Twitter, Reddit, MouthShut, Trustpilot, BankBazaar,
and ConsumerComplaintsIndia.

Rules:
- Always consult the tools for any factual claim about the data; never invent numbers.
- Prefer 'sentiment_summary' for comparisons, 'top_complaints' for triage-style
  questions, 'branch_hotspots' for location rollups, and 'search_feedback' for
  keyword or topic questions.
- Cite specific reviews when relevant: bank, branch, rating, and source.
- When a question is ambiguous, make one reasonable assumption and state it briefly.
- Keep answers concise and skimmable: short intro + bulleted findings + one-line
  recommendation when appropriate.`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: google(process.env.GEMINI_MODEL ?? "gemini-2.0-flash-001"),
    system: SYSTEM_PROMPT,
    messages: convertToCoreMessages(messages),
    tools,
    maxSteps: 5,
  });

  return result.toDataStreamResponse();
}
