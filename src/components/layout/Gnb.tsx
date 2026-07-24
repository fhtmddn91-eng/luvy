import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { gnbLinks } from "@/lib/mock/nav";

export function Gnb() {
  return (
    <nav className="no-scrollbar mx-auto flex max-w-[1280px] items-center gap-2 overflow-x-auto px-4 pb-2.5 pt-1.5 sm:px-6">
      <button
        type="button"
        className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white px-3.5 py-2 text-[14px] font-bold text-ink transition-colors hover:border-brand-300 hover:text-brand-600 md:flex"
      >
        <Icon name="menu" className="h-4.5 w-4.5 h-[18px] w-[18px]" strokeWidth={2} />
        전체 카테고리
        <Icon name="chevronDown" className="h-4 w-4 text-muted" strokeWidth={2} />
      </button>

      <div className="flex items-center gap-1">
        {gnbLinks.map((link, i) => (
          <Link
            key={`${link.href}-${i}`}
            href={link.href}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-bold text-ink transition-colors hover:bg-brand-50 hover:text-brand-500 sm:px-3.5 sm:text-[15px]"
          >
            {link.label}
            {link.badge && (
              <span className="rounded-pill bg-brand-500 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white">
                {link.badge}
              </span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
