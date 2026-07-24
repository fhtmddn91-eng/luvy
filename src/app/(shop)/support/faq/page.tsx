import Link from "next/link";

const faqs: { category: string; items: { q: string; a: string }[] }[] = [
  {
    category: "가입 · 승인",
    items: [
      {
        q: "누구나 가입할 수 있나요?",
        a: "LUVY는 사업자 회원 전용 폐쇄몰입니다. 성인용품 판매가 가능한 사업자등록증을 보유한 만 19세 이상 사업자만 가입할 수 있으며, 가입 후 관리자 승인이 완료되어야 상품 가격 확인과 주문이 가능합니다.",
      },
      {
        q: "승인은 얼마나 걸리나요?",
        a: "영업일 기준 1일 이내에 사업자 정보를 확인한 뒤 승인해 드립니다. 사업자등록번호가 확인되지 않는 경우 반려될 수 있으며, 반려 사유는 1:1 문의로 안내드립니다.",
      },
      {
        q: "비회원도 상품을 볼 수 있나요?",
        a: "아니요. LUVY는 회원제 도매몰로, 로그인하지 않으면 상품·가격을 포함한 모든 페이지를 볼 수 없습니다.",
      },
    ],
  },
  {
    category: "주문 · 가격",
    items: [
      {
        q: "MOQ(최소 주문 수량)가 무엇인가요?",
        a: "상품별로 설정된 최소 주문 수량입니다. 도매 상품 특성상 MOQ 미만으로는 주문할 수 없으며, 주문 수량이 많아질수록 단가가 낮아지는 수량별 도매가가 적용됩니다. 각 상품 상세페이지에서 수량 구간별 단가를 확인할 수 있습니다.",
      },
      {
        q: "결제는 어떤 방법으로 하나요?",
        a: "신용카드, 계좌이체 등 NHN KCP 전자결제를 지원합니다. 대량 주문 시 세금계산서 발행 및 별도 정산이 필요하면 대량구매 상담으로 문의해주세요.",
      },
      {
        q: "세금계산서 발행이 가능한가요?",
        a: "네. 사업자 회원 대상 도매몰이므로 모든 주문에 대해 세금계산서 발행이 가능합니다. 가입 시 등록한 사업자 정보로 발행됩니다.",
      },
    ],
  },
  {
    category: "배송",
    items: [
      {
        q: "배송은 얼마나 걸리나요?",
        a: "평일 오후 2시 이전 결제 완료 건은 당일 출고를 원칙으로 하며, 일반적으로 출고 후 1~2일 내 도착합니다. 도서산간 지역은 1~2일 추가될 수 있습니다.",
      },
      {
        q: "배송비는 어떻게 되나요?",
        a: "기본 배송비는 3,000원입니다. 대량 주문은 물량에 따라 별도 협의가 가능하니 대량구매 상담을 이용해주세요.",
      },
      {
        q: "포장에 상품명이 표기되나요?",
        a: "모든 상품은 내용물을 알 수 없는 무지 박스로 안전하게 포장되어 출고됩니다.",
      },
    ],
  },
  {
    category: "교환 · 반품",
    items: [
      {
        q: "교환/반품이 가능한가요?",
        a: "상품 하자·오배송의 경우 수령일로부터 7일 이내 무상 교환/반품이 가능합니다. 위생 상품 특성상 단순 변심에 의한 개봉 상품의 교환/반품은 불가합니다.",
      },
      {
        q: "불량 상품을 받았어요.",
        a: "1:1 문의에 주문번호와 불량 부위 사진을 첨부해 접수해주세요. 확인 후 교환 또는 환불 처리해 드립니다.",
      },
    ],
  },
  {
    category: "판매 지원",
    items: [
      {
        q: "판매자료(상세페이지·썸네일)를 제공하나요?",
        a: "네. 승인된 파트너에게 상품별 상세페이지, 썸네일, 옵션 이미지 원본을 무료로 제공합니다. 파트너센터에서 안내를 확인하신 뒤 필요한 상품을 문의로 요청해주세요.",
      },
      {
        q: "온라인 판매 시 주의사항이 있나요?",
        a: "성인용품 판매 시 각 오픈마켓/플랫폼의 성인 인증 정책과 청소년 보호 관련 법령을 준수해야 합니다. 상세 기준은 판매 채널별 정책을 확인해주세요.",
      },
    ],
  },
];

export default function FaqPage() {
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
                  <div className="border-t border-line/50 bg-cream/50 px-4 py-4 text-[14px] leading-relaxed text-ink-soft sm:px-6">
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
