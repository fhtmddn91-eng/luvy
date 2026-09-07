import { won } from "@/lib/format";
import { hasPrice, type Tier } from "@/lib/pricing";
import { discountedPrice, discountLabel } from "@/lib/discount";

/**
 * 수량별 도매가 표.
 *
 * 할인 회원에게는 **자기 단가**가 큰 숫자로 보여야 한다 — 여기서 정가를 보여주고
 * 주문서에서 다른 금액을 청구하면 손님이 본 표가 거짓말이 된다.
 */
export function PriceTierTable({ tiers, discountBp }: { tiers: Tier[]; discountBp: number }) {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  // 단가가 아직 안 잡힌 수집 상품은 "0원" 대신 준비중으로 알린다
  const priced = hasPrice(tiers);
  const label = discountLabel(discountBp);
  return (
    <table className="w-full overflow-hidden rounded-xl border border-line text-[14px]">
      <thead>
        <tr className="bg-brand-50 text-brand-700">
          <th className="px-4 py-2.5 text-left font-bold">주문 수량</th>
          <th className="px-4 py-2.5 text-right font-bold">
            개당 도매가
            {label && <span className="ml-1.5 text-[11.5px] font-bold">({label} 적용가)</span>}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((t, i) => {
          const next = sorted[i + 1];
          const range = next ? `${t.minQty} ~ ${next.minQty - 1}개` : `${t.minQty}개 이상`;
          const mine = discountedPrice(t.unitPrice, discountBp);
          return (
            <tr key={t.minQty} className="border-t border-line">
              <td className="px-4 py-2.5 text-ink-soft">{range}</td>
              <td className="px-4 py-2.5 text-right font-bold text-ink">
                {priced ? (
                  <>
                    {mine < t.unitPrice && (
                      <span className="mr-1.5 font-normal text-muted line-through">
                        {won(t.unitPrice)}
                      </span>
                    )}
                    {won(mine)}
                  </>
                ) : (
                  <span className="text-muted">가격 준비중</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
