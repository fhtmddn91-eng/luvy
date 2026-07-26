"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { answerInquiry, type InquiryFormState } from "@/lib/actions/inquiries";
import { btnPrimary } from "@/components/ui/Panel";
import { areaCls, errorCls } from "@/components/ui/form";

function SubmitButton({ answered }: { answered: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={btnPrimary}
    >
      {pending ? "저장 중…" : answered ? "답변 수정" : "답변 등록"}
    </button>
  );
}

export function InquiryAnswerForm({
  inquiryId,
  defaultAnswer,
}: {
  inquiryId: string;
  defaultAnswer?: string;
}) {
  const bound = answerInquiry.bind(null, inquiryId);
  const [state, formAction] = useActionState<InquiryFormState, FormData>(bound, {});

  return (
    <form action={formAction} className="space-y-3">
      <textarea
        name="answer"
        rows={6}
        defaultValue={defaultAnswer}
        placeholder="답변 내용을 입력하세요. 등록 시 회원의 1:1 문의 내역에 즉시 표시됩니다."
        className={areaCls}
      />
      {state.error && <p className={errorCls}>{state.error}</p>}
      <SubmitButton answered={Boolean(defaultAnswer)} />
    </form>
  );
}
