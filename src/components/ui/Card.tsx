import React from "react";

interface CardProps {
  children: React.ReactNode;
  variant?: "standard" | "elevated" | "gradient-border" | "dark";
  className?: string;
}

export function Card({
  children,
  variant = "standard",
  className = "",
}: CardProps) {
  if (variant === "gradient-border") {
    return (
      <div className={`gradient-border-card shadow-accent-lg ${className}`}>
        <div className="gradient-border-card-inner p-6 md:p-8">
          {children}
        </div>
      </div>
    );
  }

  if (variant === "dark") {
    return (
      <div
        className={`rounded-2xl bg-[#0F172A] border border-slate-800 text-white shadow-2xl p-6 md:p-8 relative overflow-hidden dot-pattern-dark ${className}`}
      >
        {children}
      </div>
    );
  }

  const baseStyles =
    "rounded-2xl border border-[#E2E8F0] bg-white transition-all duration-300 p-6 md:p-8";

  const variantStyles = {
    standard: "shadow-md hover:shadow-xl hover:-translate-y-1 hover:border-[rgba(0,82,255,0.3)]",
    elevated: "shadow-xl hover:shadow-2xl hover:-translate-y-1 border-[rgba(0,82,255,0.2)]",
  };

  return (
    <div
      className={`${baseStyles} ${
        variantStyles[variant as "standard" | "elevated"]
      } ${className}`}
    >
      {children}
    </div>
  );
}
