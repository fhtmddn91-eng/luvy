import Link from "next/link";
import { InquiryForm } from "./InquiryForm";
import type { InquiryType } from "@/lib/inquiry";

/** 파트너 하위 문의 페이지(입점/대량구매/제휴) 공용 레이아웃 */
export function PartnerInquiry({
  eyebrow,
  title,
  intro,
  points,
  type,
  back,
  submitted,
  titlePlaceholder,
  contentPlaceholder,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  points: string[];
  type: InquiryType;
  back: string;
  submitted?: boolean;
  titlePlaceholder?: string;
  contentPlaceholder?: string;
}) {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">{eyebrow}</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">{title}</h1>
      <p className="mb-6 mt-1 text-[14px] leading-relaxed text-muted">{intro}</p>

      {submitted && (
        <div className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-[14px] font-semibold text-brand-700">
          문의가 접수되었습니다. 담당자가 확인 후 영업일 기준 24시간 내 연락드립니다.
          진행 상황은{" "}
          <Link href="/support/inquiry" className="underline">
            1:1 문의 내역
          </Link>
          에서 확인할 수 있습니다.
        </div>
      )}

      <div className="mb-6 rounded-2xl bg-cream p-5 sm:p-6">
        <p className="mb-2 text-[13px] font-bold text-ink">이런 내용을 적어주시면 좋아요</p>
        <ul className="space-y-1 text-[13px] text-ink-soft">
          {points.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-brand-400">•</span>
              {p}
            </li>
          ))}
        </ul>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <InquiryForm
          type={type}
          back={back}
          titlePlaceholder={titlePlaceholder}
          contentPlaceholder={contentPlaceholder}
        />
      </section>

      <div className="mt-6 text-center">
        <Link href="/partner" className="text-[13px] text-muted hover:text-brand-500">
          ← 파트너센터로 돌아가기
        </Link>
      </div>
    </div>
  );
}
