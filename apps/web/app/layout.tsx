import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrgPortal",
  description: "OrgPortal — Next.js + NestJS rewrite",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
