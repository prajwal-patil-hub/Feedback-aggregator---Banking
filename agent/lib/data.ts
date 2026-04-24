import reviewsJson from "../../mock-data/reviews.json";

export type Review = {
  bank: string;
  branch: string | null;
  review_text: string;
  rating: number | null;
  author: string;
  date: string;
  url: string;
  source_name: string;
};

type Raw = { reviews: Review[] };

export const REVIEWS: Review[] = (reviewsJson as Raw).reviews;

export function classifySentiment(
  rating: number | null,
  text: string,
): "positive" | "neutral" | "negative" {
  if (rating != null) {
    if (rating >= 4) return "positive";
    if (rating <= 2) return "negative";
    return "neutral";
  }
  const t = text.toLowerCase();
  const neg = /(worst|pathetic|rude|ignored|fraud|fail|crash|slow|terrible|bad)/;
  const pos = /(excellent|great|fantastic|smooth|helpful|love|best|happy)/;
  if (neg.test(t)) return "negative";
  if (pos.test(t)) return "positive";
  return "neutral";
}
