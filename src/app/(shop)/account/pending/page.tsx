import Link from "next/link";
import { requireUser } from "@/lib/auth";

const STATUS_LABEL: Record<string, string> = { PENDING: "승인 대기", REJECTED: "반려" };

const STATUS_MESSAGE: Record<string, { title: string; desc: string }> = {
  PENDING: {
    title: "가입 승인 대기 중입니다",
    desc: "사업자 정보 확인 후 승인되면 도매가 확인과 주문이 가능합니다. 보통 영업일 기준 1일 이내 처리됩니다.",
  },
  REJECTED: {
    title: "가입이 반려되었습니다",
    desc: "사업자 정보 확인에 실패했습니다. 고객센터로 문의해주세요.",
  },
};

export default async function PendingPage() {
  const user = await requireUser();
  // 이미 승인된 회원이면 안내가 필요 없음
  if (user.status === "APPROVED") {
    return (
      <div className="mx-auto max-w-[520px] px-6 py-20 text-center">
        <h1 className="text-[22px] font-extrabold text-ink">이미 승인된 회원입니다</h1>
        <Link href="/" className="mt-6 inline-block rounded-pill bg-brand-500 px-6 py-3 text-[14px] font-bold text-white hover:bg-brand-600">
          쇼핑하러 가기
        </Link>
      </div>
    );
  }

  const msg = STATUS_MESSAGE[user.status] ?? STATUS_MESSAGE.PENDING;

  return (
    <div className="mx-auto max-w-[560px] px-6 py-20 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-[30px]">
        ⏳
      </div>
      <h1 className="text-[24px] font-extrabold text-ink">{msg.title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{msg.desc}</p>
      <div className="mt-6 inline-flex items-center gap-2 rounded-pill bg-cream px-4 py-2 text-[13px] text-muted">
        현재 상태: <span className="font-bold text-brand-600">{STATUS_LABEL[user.status] ?? user.status}</span>
      </div>
      <div className="mt-8">
        <Link href="/" className="rounded-pill border border-brand-300 bg-white px-6 py-3 text-[14px] font-bold text-brand-600 hover:bg-brand-50">
          메인으로
        </Link>
      </div>
    </div>
  );
}
