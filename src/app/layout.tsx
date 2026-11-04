import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FailSafe",
  description:
    "Financial dependency risk prototype. Demo data only; not an official Ramp product.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
