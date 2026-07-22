"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const options = [
  { value: "new", label: "신상품순" },
  { value: "priceAsc", label: "가격 낮은순" },
  { value: "priceDesc", label: "가격 높은순" },
];

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("sort") ?? "new";

  return (
    <select
      value={current}
      onChange={(e) => {
        const sp = new URLSearchParams(params);
        sp.set("sort", e.target.value);
        router.push(`${pathname}?${sp.toString()}`);
      }}
      className="h-10 rounded-lg border border-line bg-white px-3 text-[13px] text-ink focus:border-brand-400 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
