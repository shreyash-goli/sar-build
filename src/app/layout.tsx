import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FailSafe", template: "%s · FailSafe" },
  description:
    "Financial dependency risk prototype. Demo data only; not an official Ramp product.",
};

export const viewport: Viewport = {
  themeColor: "#F4F2F0",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
