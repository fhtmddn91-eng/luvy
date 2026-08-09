import { won } from "@/lib/format";
import { hasPrice, type Tier } from "@/lib/pricing";

export function PriceTierTable({ tiers }: { tiers: Tier[] }) {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  // 단가가 아직 안 잡힌 수집 상품은 "0원" 대신 준비중으로 알린다
  const priced = hasPrice(tiers);
  return (
    <table className="w-full overflow-hidden rounded-xl border border-line text-[14px]">
      <thead>
        <tr className="bg-brand-50 text-brand-700">
          <th className="px-4 py-2.5 text-left font-bold">주문 수량</th>
          <th className="px-4 py-2.5 text-right font-bold">개당 도매가</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((t, i) => {
          const next = sorted[i + 1];
          const range = next ? `${t.minQty} ~ ${next.minQty - 1}개` : `${t.minQty}개 이상`;
          return (
            <tr key={t.minQty} className="border-t border-line">
              <td className="px-4 py-2.5 text-ink-soft">{range}</td>
              <td className="px-4 py-2.5 text-right font-bold text-ink">
                {priced ? won(t.unitPrice) : <span className="text-muted">가격 준비중</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
