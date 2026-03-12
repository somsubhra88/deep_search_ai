import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/context/ThemeContext";
import { CommandPaletteProvider } from "@/context/CommandPaletteContext";
import { AuthProvider } from "@/context/AuthContext";
import SharedHeader from "@/components/navigation/SharedHeader";
import GlobalShortcuts from "@/components/GlobalShortcuts";

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
        <div className="app-bg-layer" aria-hidden="true" />
        <div className="app-noise-layer" aria-hidden="true" />
        <ThemeProvider>
          <AuthProvider>
            <CommandPaletteProvider>
              <GlobalShortcuts />
              <SharedHeader />
              {children}
            </CommandPaletteProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
