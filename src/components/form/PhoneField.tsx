"use client";

import { useState } from "react";
import { formatPhone } from "@/lib/phone";

/**
 * 전화번호 입력 — 치는 대로 하이픈이 붙는다.
 *
 * 커서를 되돌리지 않으려고 **항상 끝에서 이어 치는 경우만** 자연스럽게 만든다.
 * 가운데를 고치면 커서가 끝으로 가는데, 전화번호는 짧아서 다시 치는 편이 빠르다 —
 * 커서 위치를 계산해 되돌리는 코드는 브라우저·IME 마다 어긋나 버그가 더 많았다.
 */
export function PhoneField({
  label,
  name = "phone",
  defaultValue = "",
  required = true,
}: {
  label: string;
  name?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(() => formatPhone(defaultValue));
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-soft">{label}</span>
      <input
        name={name}
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        required={required}
        placeholder="010-0000-0000"
        value={value}
        onChange={(e) => setValue(formatPhone(e.target.value))}
        className="h-12 w-full rounded-xl border border-line bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none"
      />
    </label>
  );
}
