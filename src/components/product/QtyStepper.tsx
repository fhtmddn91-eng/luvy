"use client";

interface QtyStepperProps {
  value: number;
  min: number;
  onChange: (v: number) => void;
}

export function QtyStepper({ value, min, onChange }: QtyStepperProps) {
  return (
    <div className="inline-flex h-11 items-center rounded-pill border border-line bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-full w-11 items-center justify-center text-[18px] text-ink-soft hover:text-brand-500"
        aria-label="수량 감소"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="h-full w-14 [appearance:textfield] bg-transparent text-center text-[15px] font-semibold text-ink focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        aria-label="수량"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-full w-11 items-center justify-center text-[18px] text-ink-soft hover:text-brand-500"
        aria-label="수량 증가"
      >
        +
      </button>
    </div>
  );
}
