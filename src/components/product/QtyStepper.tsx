"use client";

interface QtyStepperProps {
  value: number;
  min: number;
  /** 재고 상한. 없으면 무제한 */
  max?: number;
  onChange: (v: number) => void;
}

export function QtyStepper({ value, min, max, onChange }: QtyStepperProps) {
  const clamp = (v: number) => {
    const lower = Math.max(min, v);
    return max !== undefined ? Math.min(max, lower) : lower;
  };
  const atMax = max !== undefined && value >= max;

  return (
    <div className="inline-flex h-11 items-center rounded-pill border border-line bg-white">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        className="flex h-full w-11 items-center justify-center text-[18px] text-ink-soft hover:text-brand-500"
        aria-label="수량 감소"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
        className="h-full w-14 [appearance:textfield] bg-transparent text-center text-[15px] font-semibold text-ink focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        aria-label="수량"
      />
      <button
        type="button"
        disabled={atMax}
        onClick={() => onChange(clamp(value + 1))}
        className="flex h-full w-11 items-center justify-center text-[18px] text-ink-soft transition-colors hover:text-brand-500 disabled:text-line"
        aria-label="수량 증가"
      >
        +
      </button>
    </div>
  );
}
