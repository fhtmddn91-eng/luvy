import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { utilLinks } from "@/lib/mock/nav";

export function UtilBar() {
  return (
    <div className="w-full bg-brand-100/80 text-brand-700">
      <div className="mx-auto flex h-9 max-w-[1280px] items-center justify-between px-6 text-[12px]">
        <div className="flex items-center gap-2 font-medium">
          <Icon name="truck" className="h-3.5 w-3.5" strokeWidth={2} />
          <span>빠르고 안전한 B2B 배송 시스템</span>
        </div>
        <nav className="flex items-center">
          {utilLinks.map((link, i) => (
            <div key={link.href} className="flex items-center">
              {i > 0 && (
                <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
              )}
              <Link
                href={link.href}
                className="text-brand-700/80 transition-colors hover:text-brand-700"
              >
                {link.label}
              </Link>
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
