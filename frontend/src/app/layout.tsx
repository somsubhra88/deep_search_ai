import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deep Search AI Agent",
  description: "AI-powered research agent with live progress streaming",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
