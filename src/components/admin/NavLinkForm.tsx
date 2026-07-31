"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createNavLink, updateNavLink, type NavFormState } from "@/lib/actions/admin-nav";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "저장 중…" : label}
    </button>
  );
}

/** 상단 메뉴 추가/수정 폼. id 가 있으면 수정. */
export function NavLinkForm({
  item,
}: {
  item?: { id: string; label: string; href: string; badge: string };
}) {
  const action = item ? updateNavLink.bind(null, item.id) : createNavLink;
  const [state, formAction] = useActionState<NavFormState, FormData>(action, {});

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end">
      <div>
        <label className={labelCls}>메뉴 이름</label>
        <input name="label" defaultValue={item?.label} maxLength={20} placeholder="신상품" className={fieldCls} />
      </div>
      <div>
        <label className={labelCls}>링크</label>
        <input name="href" defaultValue={item?.href} maxLength={200} placeholder="/new" className={fieldCls} />
      </div>
      <div>
        <label className={labelCls}>배지</label>
        <input name="badge" defaultValue={item?.badge} maxLength={6} placeholder="NEW" className={`${fieldCls} w-24`} />
      </div>
      <Submit label={item ? "수정" : "추가"} />

      {state.error && <p className={`${errorCls} sm:col-span-4`}>{state.error}</p>}
      {!item && (
        <p className={`${helpCls} sm:col-span-4`}>
          링크는 사이트 내부 주소만 됩니다. 예) <code>/new</code> · <code>/best</code> ·{" "}
          <code>/category/men</code> · <code>/support</code>. 배지는 비워두면 표시되지 않습니다.
        </p>
      )}
    </form>
  );
}
