import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost";
  children: React.ReactNode;
  className?: string;
}

export function Button({
  variant = "primary",
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    "group inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#0052FF] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none";

  const variantStyles = {
    primary:
      "bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] text-white shadow-sm hover:shadow-accent hover:-translate-y-0.5 active:scale-[0.98] border border-transparent px-6 py-3.5",
    outline:
      "bg-transparent border border-[#E2E8F0] text-[#0F172A] hover:bg-[#F1F5F9] hover:border-[rgba(0,82,255,0.3)] hover:-translate-y-0.5 active:scale-[0.98] px-6 py-3.5",
    ghost:
      "bg-transparent text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] px-4 py-2",
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
