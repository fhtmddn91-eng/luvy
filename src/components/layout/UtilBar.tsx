import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AuthMenu } from "@/components/account/AuthMenu";

export function UtilBar() {
  return (
    <div className="w-full bg-brand-100/80 text-brand-700">
      <div className="mx-auto flex h-9 max-w-[1280px] items-center justify-between px-4 text-[12px] sm:px-6">
        <div className="hidden items-center gap-2 font-medium sm:flex">
          <Icon name="truck" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="whitespace-nowrap">빠르고 안전한 B2B 배송 시스템</span>
        </div>
        <nav className="ml-auto flex min-w-0 items-center whitespace-nowrap">
          <AuthMenu />
          <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
          <Link href="/support" className="text-brand-700/80 transition-colors hover:text-brand-700">
            고객센터
          </Link>
        </nav>
      </div>
    </div>
  );
}
