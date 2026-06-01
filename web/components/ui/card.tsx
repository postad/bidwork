import { type ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-bw-border rounded-2xl ${className}`}>{children}</div>
  );
}
