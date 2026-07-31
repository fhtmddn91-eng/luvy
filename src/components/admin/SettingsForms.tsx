"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateShippingSettings,
  changeAdminPassword,
  updateLogo,
  updateCompanyInfo,
  resetCompanyInfo,
  type SettingsFormState,
} from "@/lib/actions/admin-settings";
import { COMPANY_FIELDS, type CompanyInfo } from "@/lib/company";
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

/** 로고 교체 — 업로드하면 헤더·로그인·푸터에 바로 반영된다 */
export function LogoForm({ current }: { current: string }) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(updateLogo, {});

  return (
    <div className="space-y-3">
      {current ? (
        <div className="flex items-center gap-3 border border-hairline bg-canvas px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current} alt="현재 로고" className="h-9 w-auto max-w-[190px] object-contain" />
          <span className="text-[12px] text-muted">현재 로고</span>
        </div>
      ) : (
        <p className="text-[13px] text-muted">
          지금은 기본 LUVY 로고를 쓰고 있습니다. 이미지를 올리면 교체됩니다.
        </p>
      )}

      <form action={formAction} className="space-y-2">
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="block w-full text-[13px] text-ink-soft file:mr-3 file:border file:border-hairline file:bg-white file:px-4 file:py-2 file:text-[12px] file:font-bold file:text-ink-deep hover:file:border-ink-deep"
        />
        <p className={helpCls}>
          PNG·JPG·WebP, 5MB 이하. 헤더에서 <strong>높이 36px</strong>로 표시되므로 가로로 긴
          이미지(예: 360×72)에 배경이 투명한 PNG를 권장합니다.
        </p>
        {state.error && <p className={errorCls}>{state.error}</p>}
        {state.ok && !state.error && (
          <p className="border border-hairline bg-canvas px-4 py-3 text-[13px] font-semibold text-ink-deep">
            저장되었습니다.
          </p>
        )}
        <div className="flex gap-2">
          <SubmitButton label="로고 저장" />
          {current && (
            <button
              type="submit"
              name="reset"
              value="1"
              className="h-11 border border-hairline bg-white px-5 text-[13px] font-bold text-ink-soft hover:border-ink-deep hover:text-ink-deep"
            >
              기본 로고로 되돌리기
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * 사업자·고객센터 정보.
 * 이 값들이 푸터·이용약관·개인정보처리방침·가입 안내에 그대로 들어간다.
 */
export function CompanyInfoForm({ current }: { current: CompanyInfo }) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateCompanyInfo,
    {},
  );

  return (
    <form action={formAction} className="space-y-3.5">
      {COMPANY_FIELDS.map(({ key, label, help }) => (
        <div key={key}>
          <label htmlFor={`company-${key}`} className={labelCls}>
            {label}
          </label>
          <input
            id={`company-${key}`}
            name={key}
            defaultValue={current[key]}
            maxLength={200}
            autoComplete="off"
            className={fieldCls}
          />
          {help && <p className={helpCls}>{help}</p>}
        </div>
      ))}

      {state.error && <p className={errorCls}>{state.error}</p>}
      {state.ok && !state.error && (
        <p className="border border-hairline bg-canvas px-4 py-3 text-[13px] font-semibold text-ink-deep">
          저장되었습니다. 푸터·약관·개인정보처리방침에 바로 반영됩니다.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <SubmitButton label="사업자 정보 저장" />
        <button
          type="button"
          onClick={() => {
            if (confirm("저장한 값을 지우고 기본값으로 되돌립니다. 계속할까요?")) {
              void resetCompanyInfo();
            }
          }}
          className="h-11 border border-hairline bg-white px-5 text-[13px] font-bold text-ink-soft hover:border-ink-deep hover:text-ink-deep"
        >
          기본값으로 되돌리기
        </button>
      </div>
    </form>
  );
}
