"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateShippingSettings,
  changeAdminPassword,
  type SettingsFormState,
} from "@/lib/actions/admin-settings";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "저장 중…" : label}
    </button>
  );
}

function Result({ state, okText }: { state: SettingsFormState; okText: string }) {
  if (state.error) return <p className={errorCls}>{state.error}</p>;
  if (state.ok)
    return (
      <p className="border border-hairline bg-canvas px-4 py-3 text-[13px] font-semibold text-ink-deep">
        {okText}
      </p>
    );
  return null;
}

export function ShippingSettingsForm({
  fee,
  freeThreshold,
}: {
  fee: number;
  freeThreshold: number;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateShippingSettings,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="fee" className={labelCls}>
          기본 배송비 (원)
        </label>
        <input
          id="fee"
          name="fee"
          type="number"
          min={0}
          step={100}
          defaultValue={fee}
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="freeThreshold" className={labelCls}>
          무료배송 기준 금액 (원)
        </label>
        <input
          id="freeThreshold"
          name="freeThreshold"
          type="number"
          min={0}
          step={1000}
          defaultValue={freeThreshold}
          className={fieldCls}
        />
        <p className={helpCls}>
          상품 합계가 이 금액 이상이면 배송비 무료. 0으로 두면 모든 주문이 무료배송입니다.
        </p>
      </div>
      <Result state={state} okText="저장되었습니다. 장바구니·결제 화면에 바로 적용됩니다." />
      <SubmitButton label="배송비 저장" />
    </form>
  );
}

export function AdminPasswordForm() {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    changeAdminPassword,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="pw-current" className={labelCls}>
          현재 비밀번호
        </label>
        <input
          id="pw-current"
          name="current"
          type="password"
          autoComplete="current-password"
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="pw-next" className={labelCls}>
          새 비밀번호 (8자 이상)
        </label>
        <input
          id="pw-next"
          name="next"
          type="password"
          autoComplete="new-password"
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="pw-confirm" className={labelCls}>
          새 비밀번호 확인
        </label>
        <input
          id="pw-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          className={fieldCls}
        />
      </div>
      <Result state={state} okText="변경되었습니다. 다음 로그인부터 새 비밀번호를 쓰세요." />
      <SubmitButton label="비밀번호 변경" />
    </form>
  );
}
