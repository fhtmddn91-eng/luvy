import Link from "next/link";
import { Logo } from "./Logo";
import { Gnb } from "./Gnb";
import { SearchBar } from "./SearchBar";
import { Icon } from "@/components/ui/Icon";
import { getCartCount } from "@/lib/actions/cart";

export async function Header() {
  const cartCount = await getCartCount();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      {/* 상단: 로고 + 중앙 검색 + 우측 액션 */}
      <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-6 pb-2 pt-4">
        <Logo />

        <div className="flex flex-1 justify-center">
          <SearchBar />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/orders"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-semibold text-ink transition-colors hover:bg-brand-50 hover:text-brand-600"
          >
            <Icon name="userRound" className="h-5 w-5" strokeWidth={1.7} />
            마이페이지
          </Link>
          <Link
            href="/partner"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-semibold text-ink transition-colors hover:bg-brand-50 hover:text-brand-600"
          >
            <Icon name="partner" className="h-5 w-5" strokeWidth={1.7} />
            파트너센터
          </Link>
          <Link
            href="/cart"
            aria-label="장바구니"
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-brand-50 hover:text-brand-500"
          >
            <Icon name="cart" className="h-6 w-6" strokeWidth={1.6} />
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* 하단: 전체 카테고리 + GNB */}
      <Gnb />
    </header>
  );
}
