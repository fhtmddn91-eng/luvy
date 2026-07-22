import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { gnbLinks } from "@/lib/mock/nav";

export function Gnb() {
  return (
    <nav className="hidden items-center gap-7 lg:flex">
      {gnbLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="group flex items-center gap-1 text-[15px] font-semibold text-ink transition-colors hover:text-brand-500"
        >
          {link.label}
          {link.hasDropdown && (
            <Icon
              name="chevronDown"
              className="h-4 w-4 text-muted transition-colors group-hover:text-brand-500"
              strokeWidth={2}
            />
          )}
        </Link>
      ))}
    </nav>
  );
}
