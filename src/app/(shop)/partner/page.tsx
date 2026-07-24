import Link from "next/link";
import { getSession } from "@/lib/auth";
import { Icon } from "@/components/ui/Icon";

const benefits = [
  {
    icon: "download",
    title: "판매자료 무료 제공",
    desc: "상세페이지·썸네일·옵션 이미지 원본을 상품별로 제공합니다. 받아서 바로 판매를 시작하세요.",
  },
  {
    icon: "package",
    title: "부담 없는 소량 도매",
    desc: "낮은 MOQ로 시작해 수량이 늘수록 단가가 내려가는 구간별 도매가를 적용합니다.",
  },
  {
    icon: "truck",
    title: "당일 출고 물류",
    desc: "평일 14시 이전 결제 건 당일 출고. 무지 박스 안전 포장으로 고객 배송도 안심.",
  },
  {
    icon: "headset",
    title: "전담 파트너 매니저",
    desc: "입점부터 운영까지 1:1 전담 매니저가 상품 추천과 재고 문의에 바로 응답합니다.",
  },
] as const;

const steps = [
  { no: "01", title: "사업자 회원가입", desc: "사업자등록번호로 가입 신청" },
  { no: "02", title: "승인 완료", desc: "영업일 기준 1일 이내 심사·승인" },
  { no: "03", title: "도매가 확인·주문", desc: "전 상품 도매가와 판매자료 이용" },
  { no: "04", title: "판매 시작", desc: "내 스토어에 등록하고 판매 개시" },
] as const;

export default async function PartnerPage() {
  const user = await getSession();
  const approved = user?.status === "APPROVED";

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-6">
      {/* 인트로 */}
      <section className="rounded-3xl bg-gradient-to-br from-brand-50 to-brand-100 px-6 py-10 text-center sm:px-10 sm:py-14">
        <p className="text-[13px] font-bold uppercase tracking-[0.22em] text-brand-500">
          LUVY PARTNER CENTER
        </p>
        <h1 className="mt-3 text-[26px] font-extrabold leading-snug text-ink sm:text-[34px]">
          판매는 당신이, 준비는 LUVY가.
        </h1>
        <p className="mx-auto mt-3 max-w-[560px] text-[14px] leading-relaxed text-ink-soft sm:text-[15px]">
          상세페이지 제작부터 재고·물류까지, 판매에 필요한 모든 준비를 LUVY가 대신합니다.
          파트너님은 판매에만 집중하세요.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          {approved ? (
            <Link
              href="/new"
              className="rounded-pill bg-brand-500 px-7 py-3 text-[14px] font-bold text-white hover:bg-brand-600"
            >
              도매가로 상품 보기
            </Link>
          ) : (
            <Link
              href="/signup"
              className="rounded-pill bg-brand-500 px-7 py-3 text-[14px] font-bold text-white hover:bg-brand-600"
            >
              파트너 가입하기
            </Link>
          )}
          <Link
            href="/partner/apply"
            className="rounded-pill border border-brand-300 bg-white px-7 py-3 text-[14px] font-bold text-brand-600 hover:border-brand-400"
          >
            입점 문의하기
          </Link>
        </div>
      </section>

      {/* 혜택 */}
      <section className="mt-12">
        <h2 className="text-center text-[20px] font-extrabold text-ink sm:text-[22px]">
          LUVY 파트너 혜택
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {benefits.map((b) => (
            <div key={b.title} className="rounded-2xl border border-line bg-white p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                <Icon name={b.icon} className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <h3 className="mt-3 text-[16px] font-bold text-ink">{b.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 프로세스 */}
      <section className="mt-12">
        <h2 className="text-center text-[20px] font-extrabold text-ink sm:text-[22px]">
          시작하는 방법
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.no} className="rounded-2xl bg-cream p-5">
              <p className="text-[13px] font-extrabold text-brand-400">{s.no}</p>
              <p className="mt-1 text-[15px] font-bold text-ink">{s.title}</p>
              <p className="mt-1 text-[12px] text-muted">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 판매자료 안내 */}
      <section className="mt-12 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="download" className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold text-ink">판매자료 다운로드</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              승인된 파트너에게 상품별 상세페이지·썸네일·옵션 이미지 원본을 무료로 제공합니다.
              필요한 상품명을 적어 요청해주시면 다운로드 링크를 보내드립니다.
            </p>
          </div>
          <Link
            href={approved ? "/support/inquiry" : "/signup"}
            className="shrink-0 rounded-pill bg-brand-500 px-6 py-2.5 text-[13px] font-bold text-white hover:bg-brand-600"
          >
            {approved ? "자료 요청하기" : "가입 후 이용 가능"}
          </Link>
        </div>
      </section>

      {/* 문의 링크 3종 */}
      <section className="mt-12 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/partner/apply", title: "입점 문의", desc: "브랜드·제조사 입점 상담" },
          { href: "/partner/bulk", title: "대량구매 상담", desc: "대량 발주·정기 납품 견적" },
          { href: "/partner/alliance", title: "제휴 제안", desc: "마케팅·유통 제휴 제안" },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-2xl border border-line bg-white p-5 transition-shadow hover:shadow-[var(--shadow-card)]"
          >
            <p className="flex items-center gap-1 text-[15px] font-bold text-ink group-hover:text-brand-600">
              {c.title}
              <Icon name="chevronRight" className="h-4 w-4 text-brand-400" strokeWidth={2.2} />
            </p>
            <p className="mt-1 text-[12px] text-muted">{c.desc}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
