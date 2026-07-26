"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setShipping, type ShippingFormState } from "@/lib/actions/admin-orders";
import { COURIERS } from "@/lib/shipping";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";

function SubmitButton({ registered }: { registered: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full bg-ink-deep text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      {pending ? "저장 중…" : registered ? "송장 수정" : "송장 등록"}
    </button>
  );
}

export function ShippingForm({
  orderId,
  courier,
  trackingNo,
}: {
  orderId: string;
  courier: string;
  trackingNo: string;
}) {
  const bound = setShipping.bind(null, orderId);
  const [state, formAction] = useActionState<ShippingFormState, FormData>(bound, {});
  const registered = courier !== "" && trackingNo !== "";

  // React 19 는 서버 액션 제출 후 form 을 초기화한다. 검증 실패로 되돌아왔을 때
  // 운영자가 고른 택배사와 붙여넣은 번호가 사라지지 않도록, 서버가 돌려준 제출값을
  // 기본값으로 다시 심고 key 를 바꿔 form 을 그 값으로 마운트한다.
  const courierValue = state.values?.courier ?? courier;
  const noValue = state.values?.trackingNo ?? trackingNo;

  return (
    <form
      key={`${courierValue}|${noValue}`}
      action={formAction}
      className="space-y-3"
    >
      <div>
        <label htmlFor="courier" className={labelCls}>
          택배사
        </label>
        <select id="courier" name="courier" defaultValue={courierValue} className={fieldCls}>
          <option value="">선택하세요</option>
          {COURIERS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="trackingNo" className={labelCls}>
          운송장번호
        </label>
        <input
          id="trackingNo"
          name="trackingNo"
          defaultValue={noValue}
          inputMode="numeric"
          autoComplete="off"
          placeholder="예) 1234-5678-9012"
          className={fieldCls}
        />
        <p className={helpCls}>
          저장하면 주문이 <strong className="font-bold text-ink-soft">배송중</strong>으로 바뀌고,
          회원 주문 상세에 배송 조회 버튼이 표시됩니다.
          {registered && " 두 칸을 모두 비우고 저장하면 송장이 삭제됩니다."}
        </p>
      </div>

      {state.error && <p className={errorCls}>{state.error}</p>}
      <SubmitButton registered={registered} />
    </form>
  );
}
