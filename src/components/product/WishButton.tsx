"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { toggleWishlist } from "@/lib/actions/wishlist";

/**
 * 찜(관심상품) 하트 버튼.
 *
 * 누른 즉시 색이 바뀌고 서버 응답으로 확정한다 — 왕복을 기다리면
 * 두 번 누르게 되고, 그게 곧 "담았다 뺐다"가 되어 버린다.
 */
export function WishButton({
  productId,
  initial,
  variant = "full",
}: {
  productId: string;
  initial: boolean;
  /** full: 라벨까지 있는 버튼 / icon: 하트만 */
  variant?: "full" | "icon";
}) {
  const [wished, setWished] = useState(initial);
  const [pending, startTransition] = useTransition();

  const click = () => {
    const next = !wished;
    setWished(next); // 낙관적 반영
    startTransition(async () => {
      const confirmed = await toggleWishlist(productId);
      setWished(confirmed);
    });
  };

  const label = wished ? "찜한 상품" : "찜하기";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={click}
        disabled={pending}
        aria-pressed={wished}
        aria-label={label}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded-full border bg-white/90 backdrop-blur transition-colors ${
          wished ? "border-brand-300 text-brand-500" : "border-line text-muted hover:text-brand-500"
        }`}
      >
        <Icon
          name="heart"
          className={`h-[18px] w-[18px] ${wished ? "fill-current" : ""}`}
          strokeWidth={2}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-pressed={wished}
      className={`flex h-12 shrink-0 items-center gap-2 rounded-pill border px-4 text-[14px] font-bold transition-colors disabled:opacity-60 ${
        wished
          ? "border-brand-300 bg-brand-50 text-brand-600"
          : "border-line bg-white text-ink-soft hover:border-brand-300 hover:text-brand-600"
      }`}
    >
      <Icon
        name="heart"
        className={`h-[18px] w-[18px] ${wished ? "fill-current" : ""}`}
        strokeWidth={2}
      />
      {label}
    </button>
  );
}
