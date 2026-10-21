import Link from "next/link";

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="mcp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1648d0" />
          <stop offset="1" stopColor="#06c4af" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#mcp-g)" />
      <path d="M24 11 10 22.5V36a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V22.5Z" fill="#fff" opacity=".18" />
      <path d="M24 12.5 11.5 23v12.5h25V23Z" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M21.2 22h5.6v4.2H31v5.6h-4.2V36h-5.6v-4.2H17v-5.6h4.2Z" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Médico en Casa Palmira — inicio">
      <LogoMark />
      <span className="leading-none">
        <span className="block font-display text-[15px] font-extrabold tracking-tight text-ink">MÉDICO EN CASA</span>
        <span className="block text-[11px] font-bold tracking-[0.28em] text-teal-600">PALMIRA</span>
      </span>
    </Link>
  );
}
