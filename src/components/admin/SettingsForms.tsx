"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateShippingSettings,
  changeAdminPassword,
  updateLogo,
  updateCompanyInfo,
  resetCompanyInfo,
  updateBankAccount,
  type SettingsFormState,
} from "@/lib/actions/admin-settings";
import { COMPANY_FIELDS, type CompanyInfo } from "@/lib/company";
import { BANK_FIELDS, type BankAccount } from "@/lib/bankAccount";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";
import {
  updateMemberGrades,
  updatePointPolicy,
  reevaluateAllGrades,
  type ReevaluateState,
} from "@/lib/actions/admin-settings";
import { formatRatePercent } from "@/lib/points";
import type { PointPolicy } from "@/lib/settings";
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

/**
 * 무통장입금 계좌. 계좌가 바뀔 때 배포를 기다리지 않도록 설정으로 뺐다.
 * 저장하면 주문서·주문 완료·주문 상세의 계좌 안내가 한꺼번에 바뀐다.
 */
export function BankAccountForm({ current }: { current: BankAccount }) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(updateBankAccount, {});

  return (
    <form action={formAction} className="space-y-3.5">
      {BANK_FIELDS.map(({ key, label, help }) => (
        <div key={key}>
          <label htmlFor={`bank-${key}`} className={labelCls}>
            {label}
          </label>
          <input
            id={`bank-${key}`}
            name={key}
            defaultValue={current[key]}
            maxLength={100}
            autoComplete="off"
            className={fieldCls}
          />
          {help && <p className={helpCls}>{help}</p>}
        </div>
      ))}

      <Result state={state} okText="저장되었습니다. 주문서와 주문 완료 화면에 바로 반영됩니다." />
      <SubmitButton label="입금 계좌 저장" />
    </form>
  );
}

/**
 * 회원 등급 이름·적립률 (운영자 요청서 2·3번). 등급 코드 3개는 고정, 이름과 %만 편집한다.
 * 적립은 배송완료 시점에 상품금액 × 적립률로 쌓이므로, 여기 숫자를 바꾸면 그 뒤 배송완료
 * 건부터 새 비율이 적용된다 — 이미 쌓인 포인트는 그대로다.
 */
export function MemberGradesForm({
  grades,
}: {
  grades: { code: string; name: string; pointRateBp: number; threshold: number }[];
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(updateMemberGrades, {});
  return (
    <form action={formAction} className="space-y-3.5">
      <div className="grid grid-cols-[1fr_96px_150px] gap-x-3 gap-y-2 text-[12px] font-semibold text-muted">
        <span>등급 이름</span>
        <span>적립률 (%)</span>
        <span>승급 기준 (누적 구매, 원)</span>
      </div>
      {grades.map((g, i) => (
        <div key={g.code} className="grid grid-cols-[1fr_96px_150px] gap-x-3">
          <input
            name={`name-${g.code}`}
            defaultValue={g.name}
            maxLength={20}
            aria-label={`${g.code} 등급 이름`}
            className={fieldCls}
          />
          <input
            name={`rate-${g.code}`}
            type="number"
            min={0}
            max={100}
            step={0.01}
            inputMode="decimal"
            defaultValue={formatRatePercent(g.pointRateBp)}
            aria-label={`${g.name} 적립률 (%)`}
            className={fieldCls}
          />
          {i === 0 ? (
            <span className="flex h-11 items-center text-[12.5px] text-muted">기본 등급</span>
          ) : (
            <input
              name={`threshold-${g.code}`}
              type="number"
              min={0}
              step={10000}
              inputMode="numeric"
              defaultValue={g.threshold}
              aria-label={`${g.name} 승급 기준 금액`}
              className={fieldCls}
            />
          )}
        </div>
      ))}
      <p className={helpCls}>
        적립은 주문이 배송완료로 바뀔 때 (상품금액 − 사용 포인트) × 적립률로 쌓이고, 취소되면 회수됩니다.
        승급 기준은 결제가 확인된 주문의 누적 금액이며, 배송완료 시점에 자동으로 <b>올라가기만</b> 합니다
        (내려가지 않음). 0 이면 그 등급은 수동 지정으로만 줍니다.
      </p>
      <Result state={state} okText="저장되었습니다. 다음 배송완료 건부터 새 적립률·기준이 적용됩니다." />
      <SubmitButton label="등급·적립률·기준 저장" />
    </form>
  );
}

/** 전체 회원을 지금 기준으로 다시 본다 — 기준을 낮췄을 때 기다리지 않게 */
export function ReevaluateGradesForm() {
  const [state, formAction] = useActionState<ReevaluateState, FormData>(reevaluateAllGrades, {});
  return (
    <form action={formAction} className="mt-4 border-t border-hairline-soft pt-4">
      <Result
        state={state}
        okText={`재평가가 끝났습니다. ${state.changed ?? 0}명의 등급이 올라갔습니다.`}
      />
      <button
        type="submit"
        className="h-11 border border-hairline bg-white px-5 text-[13px] font-bold text-ink-soft hover:border-ink-deep hover:text-ink-deep"
      >
        전체 회원 지금 재평가
      </button>
      <p className={helpCls}>수동 고정한 회원은 건너뜁니다. 올라가는 경우만 바뀌고, 바뀐 회원은 감사 로그에 남습니다.</p>
    </form>
  );
}

/** 포인트 사용 규칙·만료 — 마이페이지와 주문서 안내문이 이 숫자를 그대로 쓴다 */
export function PointPolicyForm({ policy }: { policy: PointPolicy }) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(updatePointPolicy, {});
  return (
    <form action={formAction} className="space-y-3.5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="pp-min" className={labelCls}>최소 사용 (P)</label>
          <input id="pp-min" name="minUse" type="number" min={0} step={100} defaultValue={policy.minUse} className={fieldCls} />
          <p className={helpCls}>0 이면 제한 없음</p>
        </div>
        <div>
          <label htmlFor="pp-unit" className={labelCls}>사용 단위 (P)</label>
          <input id="pp-unit" name="unit" type="number" min={1} step={1} defaultValue={policy.unit} className={fieldCls} />
          <p className={helpCls}>1 이면 제한 없음</p>
        </div>
        <div>
          <label htmlFor="pp-exp" className={labelCls}>만료 (개월)</label>
          <input id="pp-exp" name="expiryMonths" type="number" min={0} max={120} step={1} defaultValue={policy.expiryMonths} className={fieldCls} />
          <p className={helpCls}>0 이면 만료 없음</p>
        </div>
      </div>
      <p className={helpCls}>
        만료는 적립일 기준이며 <b>먼저 만료되는 포인트부터</b> 쓰입니다. 취소로 돌려받은 포인트는 돌려받은 날부터 다시 셉니다.
        개월 수를 바꾸면 그 뒤에 적립되는 포인트부터 적용됩니다.
      </p>
      <Result state={state} okText="저장되었습니다. 주문서와 마이페이지 안내에 바로 반영됩니다." />
      <SubmitButton label="포인트 정책 저장" />
    </form>
  );
}
