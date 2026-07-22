import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { categories } from "@/lib/mock/categories";

export function CategoryBar() {
  return (
    <div className="border-b border-line bg-white">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-6">
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] font-bold text-brand-600 transition-colors hover:bg-brand-50"
        >
          <Icon name="menu" className="h-5 w-5" strokeWidth={2} />
          전체 카테고리
        </button>

        <div className="h-5 w-px bg-line" aria-hidden />

        <nav className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/category/${cat.slug}`}
              className="group flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[14px] font-medium text-ink-soft transition-colors hover:text-brand-500"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-500 transition-colors group-hover:bg-brand-100">
                <Icon name={cat.icon} className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </span>
              {cat.name}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
