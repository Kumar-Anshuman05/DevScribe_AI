import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DevScribe AI — Intelligent Technical Content Platform",
  description: "An Agentic Platform for Intelligent Technical Content Research, Generation and Validation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20">
        {children}
      </body>
    </html>
  );
}
