import Link from "next/link";
import { db } from "@/lib/db";
import { FAQ_DEFAULTS } from "@/lib/faqDefaults";

/** 카테고리 순서를 유지하며 묶는다 (sortOrder 순으로 처음 등장한 카테고리가 먼저) */
function groupByCategory(rows: { category: string; question: string; answer: string }[]) {
  const groups: { category: string; items: { q: string; a: string }[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.category === r.category);
    if (!g) {
      g = { category: r.category, items: [] };
      groups.push(g);
    }
    g.items.push({ q: r.question, a: r.answer });
  }
  return groups;
}

export default async function FaqPage() {
  // DB에 FAQ가 있으면 그걸 쓰고, 하나도 없으면 기본 목록으로 동작한다
  const rows = await db.faq.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  const faqs = groupByCategory(rows.length > 0 ? rows : FAQ_DEFAULTS);

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">FAQ</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">자주 묻는 질문</h1>
      <p className="mb-8 mt-1 text-[14px] text-muted">
        찾는 답변이 없다면{" "}
        <Link href="/support/inquiry" className="font-semibold text-brand-500 hover:underline">
          1:1 문의
        </Link>
        를 남겨주세요.
      </p>

      <div className="space-y-8">
        {faqs.map((group) => (
          <section key={group.category}>
            <h2 className="mb-3 text-[16px] font-bold text-ink">{group.category}</h2>
            <div className="overflow-hidden rounded-2xl border border-line bg-white">
              {group.items.map((item, i) => (
                <details key={item.q} className={`group ${i > 0 ? "border-t border-line/70" : ""}`}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-[14px] font-semibold text-ink transition-colors hover:bg-brand-50/40 sm:px-6 [&::-webkit-details-marker]:hidden">
                    <span className="text-[15px] font-extrabold text-brand-400">Q</span>
                    <span className="flex-1">{item.q}</span>
                    <span className="text-muted transition-transform group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="whitespace-pre-line border-t border-line/50 bg-cream/50 px-4 py-4 text-[14px] leading-relaxed text-ink-soft sm:px-6">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link href="/support" className="text-[13px] text-muted hover:text-brand-500">
          ← 고객센터로 돌아가기
        </Link>
      </div>
    </div>
  );
}
