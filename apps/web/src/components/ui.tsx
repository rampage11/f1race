import type { ButtonHTMLAttributes, ReactNode } from "react";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
}

export function GlassPanel({ children, className }: GlassPanelProps) {
  const cls = className ? `glass-panel ${className}` : "glass-panel";
  return <div className={cls}>{children}</div>;
}

interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function NeonButton({ children, className, ...rest }: NeonButtonProps) {
  const cls = className ? `neon-button ${className}` : "neon-button";
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
