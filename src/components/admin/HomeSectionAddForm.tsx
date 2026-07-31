"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createSection, type HomeSectionState } from "@/lib/actions/admin-home";
import { HOME_MODES } from "@/lib/homeSections";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "추가 중…" : "탭 추가"}
    </button>
  );
}

export function HomeSectionAddForm() {
  const [state, formAction] = useActionState<HomeSectionState, FormData>(createSection, {});

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="sec-label" className={labelCls}>
          탭 이름
        </label>
        <input
          id="sec-label"
          name="label"
          maxLength={20}
          placeholder="예) 이번주 추천"
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="sec-mode" className={labelCls}>
          표시 방식
        </label>
        <select id="sec-mode" name="mode" defaultValue="MANUAL" className={fieldCls}>
          {Object.entries(HOME_MODES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <p className={helpCls}>
          직접 고르기를 빼면 모두 자동입니다 — 신상품·인기·재구매는 지정하는 게 아니라
          등록일·판매량·재구매로 계산됩니다.
        </p>
      </div>
      {state.error && <p className={errorCls}>{state.error}</p>}
      {state.ok && (
        <p className="border border-hairline bg-canvas px-4 py-3 text-[13px] font-semibold text-ink-deep">
          추가되었습니다.
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
