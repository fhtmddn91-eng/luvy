import { won } from "@/lib/format";
import type { Tier } from "@/lib/pricing";

export function PriceTierTable({ tiers }: { tiers: Tier[] }) {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
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
              <td className="px-4 py-2.5 text-right font-bold text-ink">{won(t.unitPrice)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
