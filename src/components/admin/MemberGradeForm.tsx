"use client";

import { useActionState } from "react";
import { setMemberGrade, type GradeFormState } from "@/lib/actions/admin-members";
import { fieldCls, errorCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

/** 회원 등급 지정 (운영자 요청서 2번) — 관리자가 수동으로 정한다 */
export function MemberGradeForm({
  memberId,
  current,
  locked,
  grades,
}: {
  memberId: string;
  current: string;
  locked: boolean;
  grades: { code: string; name: string; pointRateBp: number }[];
}) {
  const [state, formAction, pending] = useActionState<GradeFormState, FormData>(
    setMemberGrade.bind(null, memberId),
    {},
  );
  return (
    <form action={formAction} className="space-y-2.5">
      <select name="gradeCode" defaultValue={current} className={fieldCls} aria-label="회원 등급">
        {grades.map((g) => (
          <option key={g.code} value={g.code}>
            {g.name} · 적립 {g.pointRateBp / 100}%
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-[13px] text-ink-deep">
        <input name="gradeLocked" type="checkbox" defaultChecked={locked} className="h-4 w-4 accent-ink-deep" />
        등급 수동 고정 (자동 승급 제외)
      </label>
      {state.error && <p className={errorCls}>{state.error}</p>}
      {state.ok && !state.error && (
        <p className="text-[12.5px] font-semibold text-ink-deep">등급이 저장되었습니다.</p>
      )}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "저장 중…" : "등급 저장"}
      </button>
    </form>
  );
}
