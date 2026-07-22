import Link from "next/link";

/** LUVY wordmark — the "L" is drawn as a soft pink monogram tile. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 select-none" aria-label="LUVY 홈">
      <span className="relative inline-flex h-9 w-9 items-center justify-center">
        <svg viewBox="0 0 36 36" className="h-9 w-9" aria-hidden>
          <defs>
            <linearGradient id="luvyL" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f4aec6" />
              <stop offset="55%" stopColor="#e7568a" />
              <stop offset="100%" stopColor="#d63f77" />
            </linearGradient>
          </defs>
          <path
            d="M9 5c0 8.5 0 14 0 18.5C9 27 11.2 29 15 29h11"
            fill="none"
            stroke="url(#luvyL)"
            strokeWidth="5.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-[26px] font-extrabold tracking-[0.14em] text-ink">
        LUVY
      </span>
    </Link>
  );
}
