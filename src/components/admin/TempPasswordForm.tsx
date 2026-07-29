"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { issueTempPassword, type TempPasswordState } from "@/lib/actions/admin-members";
import { errorCls } from "@/components/ui/form";

function IssueButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full border border-hairline bg-white text-[13px] font-bold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep disabled:opacity-40"
    >
      {pending ? "발급 중…" : "발급 확정"}
    </button>
  );
}

/**
 * 임시 비밀번호 발급 — 비밀번호가 즉시 바뀌는 동작이라 2단계 확인을 거친다.
 * 발급된 평문은 이 화면에서 한 번만 보인다 (DB에는 해시만 저장).
 */
export function TempPasswordForm({ memberId }: { memberId: string }) {
  const bound = issueTempPassword.bind(null, memberId);
  const [state, formAction] = useActionState<TempPasswordState, FormData>(bound, {});
  const [armed, setArmed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (state.password) {
    return (
      <div className="border border-ink-deep bg-canvas p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
          임시 비밀번호
        </p>
        <p className="mt-1.5 select-all font-display text-[20px] tracking-[0.08em] text-ink-deep">
          {state.password}
        </p>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(state.password!).then(() => setCopied(true));
          }}
          className="mt-2 text-[12px] font-semibold text-ink-soft underline underline-offset-4 hover:text-ink-deep"
        >
          {copied ? "복사됨 ✓" : "복사"}
        </button>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          이 화면을 벗어나면 다시 볼 수 없습니다. 지금 회원에게 전달하고,
          로그인 후 비밀번호를 바꾸도록 안내해주세요.
        </p>
      </div>
    );
  }

  if (!armed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="h-10 w-full border border-hairline bg-white text-[13px] font-bold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
        >
          임시 비밀번호 발급
        </button>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          비밀번호를 잊은 회원에게 새 임시 비밀번호를 만들어 전달합니다.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        발급하면 <strong className="font-bold">기존 비밀번호는 즉시 무효</strong>가 됩니다.
        회원 본인의 요청인지 확인하셨나요?
      </p>
      {state.error && <p className={errorCls}>{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="h-10 shrink-0 border border-hairline bg-white px-4 text-[13px] font-bold text-muted hover:text-ink-deep"
        >
          취소
        </button>
        <IssueButton />
      </div>
    </form>
  );
}
