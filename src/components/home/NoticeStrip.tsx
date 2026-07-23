import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

const tagStyles: Record<string, string> = {
  notice: "bg-brand-100 text-brand-600",
  stock: "bg-brand-50 text-brand-500",
  event: "bg-brand-500 text-white",
};

export interface NoticeData {
  kind: string;
  tag: string;
  text: string;
}

export function NoticeStrip({ notices }: { notices: NoticeData[] }) {
  if (notices.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1280px] px-6 py-8">
      <div className="flex flex-col items-stretch gap-2 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-soft)] md:flex-row md:items-center">
        {notices.map((notice, i) => (
          <Link
            key={i}
            href="/support/notice"
            className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-brand-50/60"
          >
            <span
              className={`shrink-0 rounded-pill px-3 py-1 text-[12px] font-bold ${tagStyles[notice.kind] ?? "bg-brand-50 text-brand-500"}`}
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
          className="flex shrink-0 items-center justify-center gap-1 rounded-xl px-4 py-3 text-[13px] font-semibold text-muted transition-colors hover:text-brand-500"
        >
          더보기
          <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}
