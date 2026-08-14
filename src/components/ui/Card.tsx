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
    "rounded-2xl border border-slate-200/80 bg-white transition-all duration-300 p-6 md:p-8 hover:-translate-y-1";

  const variantStyles = {
    standard:
      "shadow-sm hover:shadow-xl hover:border-accent/40 hover:shadow-accent/5",
    elevated:
      "shadow-lg hover:shadow-2xl border-slate-200 hover:border-accent/50",
  };

  return (
    <div
      className={`${baseStyles} ${
        variantStyles[variant as "standard" | "elevated"] || variantStyles.standard
      } ${className}`}
    >
      {children}
    </div>
  );
}
