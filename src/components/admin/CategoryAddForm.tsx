"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createCategory, type CategoryFormState } from "@/lib/actions/admin-categories";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "추가 중…" : "카테고리 추가"}
    </button>
  );
}

export function CategoryAddForm() {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(createCategory, {});

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="cat-name" className={labelCls}>
          이름
        </label>
        <input id="cat-name" name="name" maxLength={30} placeholder="예) 코스튬" className={fieldCls} />
      </div>
      <div>
        <label htmlFor="cat-slug" className={labelCls}>
          주소 (slug)
        </label>
        <input
          id="cat-slug"
          name="slug"
          maxLength={40}
          placeholder="예) costume"
          autoComplete="off"
          className={fieldCls}
        />
        <p className={helpCls}>
          /category/<strong>이 값</strong> 주소로 쓰입니다. 소문자 영문·숫자·하이픈만.
          한번 만들면 바꿀 수 없습니다.
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
