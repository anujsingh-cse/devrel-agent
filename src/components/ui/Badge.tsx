import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}

export function Badge({ children, pulse = true, className = "" }: BadgeProps) {
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-full border border-[rgba(0,82,255,0.25)] bg-[rgba(0,82,255,0.06)] px-5 py-2 transition-all ${className}`}
    >
      <span
        className={`h-2 w-2 rounded-full bg-[#0052FF] ${
          pulse ? "animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-[#0052FF]">
        {children}
      </span>
    </div>
  );
}
