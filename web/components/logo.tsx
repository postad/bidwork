import Link from "next/link";

export function Logo({ href = "/", tag }: { href?: string; tag?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <span className="font-black text-[20px] tracking-tight leading-none">bidwork</span>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-bw-green" />
      {tag ? <span className="ml-2 text-[13px] text-bw-muted font-medium hidden sm:inline">{tag}</span> : null}
    </Link>
  );
}
