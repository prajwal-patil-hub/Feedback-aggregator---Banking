import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bank Feedback Insights Agent",
  description:
    "Ask questions across aggregated Indian bank customer feedback. Powered by Gemini + Vercel AI SDK.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
