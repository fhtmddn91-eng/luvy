import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { notices } from "@/lib/mock/notices";

const tagStyles: Record<string, string> = {
  notice: "bg-brand-100 text-brand-600",
  stock: "bg-brand-50 text-brand-500",
  event: "bg-brand-500 text-white",
};

export function NoticeStrip() {
  return (
    <section className="mx-auto max-w-[1280px] px-6 py-8">
      <div className="grid items-stretch gap-4 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-soft)] md:grid-cols-[1fr_1fr_1fr_auto]">
        {notices.map((notice) => (
          <Link
            key={notice.kind}
            href="/support/notice"
            className="group flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-brand-50/60"
          >
            <span
              className={`shrink-0 rounded-pill px-3 py-1 text-[12px] font-bold ${tagStyles[notice.kind]}`}
            >
              {notice.tag}
            </span>
            <span className="truncate text-[14px] text-ink-soft transition-colors group-hover:text-ink">
              {notice.text}
            </span>
          </Link>
        ))}

        <Link
          href="/support/notice"
          className="flex items-center justify-center gap-1 rounded-xl px-4 py-3 text-[13px] font-semibold text-muted transition-colors hover:text-brand-500"
        >
          더보기
          <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}
