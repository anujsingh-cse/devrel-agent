import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      className={`h-12 md:h-14 w-full rounded-xl border border-[#E2E8F0] bg-white px-4 text-sm text-[#0F172A] placeholder-[#64748B]/60 shadow-sm transition-all focus:border-[#0052FF] focus:outline-none focus:ring-2 focus:ring-[#0052FF]/20 ${className}`}
      {...props}
    />
  );
}
