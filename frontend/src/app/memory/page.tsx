import type { Metadata } from "next";
import MemoryGraphCanvas from "@/components/memory/MemoryGraphCanvas";

export const metadata: Metadata = {
  title: "Semantic Memory Graph — Deep Search AI",
  description: "Interactive graph of your past research sessions and their semantic connections.",
};

export default function MemoryPage() {
  return <MemoryGraphCanvas />;
}
