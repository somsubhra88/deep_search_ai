"use client";

import { type ReactNode } from "react";

type GlassCardProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "aside" | "article";
};

/**
 * Reusable glass morphism card: translucent background, backdrop-blur, subtle border and inner highlight.
 * Uses centralized tokens (--glass-bg, --glass-border, --glass-highlight, --glass-blur).
 */
export default function GlassCard({ children, className = "", as: Tag = "div" }: GlassCardProps) {
  return (
    <Tag className={`glass-card ${className}`.trim()}>
      {children}
    </Tag>
  );
}
