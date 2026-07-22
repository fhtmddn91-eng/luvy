import Link from "next/link";
import { Logo } from "./Logo";
import { Gnb } from "./Gnb";
import { SearchBar } from "./SearchBar";
import { Icon } from "@/components/ui/Icon";

export function Header() {
  const cartCount = 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[76px] max-w-[1280px] items-center gap-8 px-6">
        <Logo />

        <div className="flex-1">
          <Gnb />
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:block">
            <SearchBar />
          </div>

          <Link
            href="/cart"
            aria-label="장바구니"
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-brand-50 hover:text-brand-500"
          >
            <Icon name="cart" className="h-6 w-6" strokeWidth={1.6} />
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white">
              {cartCount}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
