import Link from "next/link";
import { contactPoint } from "@/lib/company";
import { getCompany } from "@/lib/companyInfo";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  const company = await getCompany();
  return (
    <AuthCard
      title="사업자 회원가입"
      subtitle={"만 19세 이상 사업자 회원만 가입할 수 있습니다.\n가입 후 관리자 승인이 완료되면 도매가 열람·주문이 가능합니다."}
      footer={
        <>
          이미 회원이신가요?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            로그인
          </Link>
        </>
      }
    >
      {/*
       * 승인을 실시간으로 지켜볼 수 없으므로, 가입자가 먼저 연락을 주면
       * 훨씬 빨리 승인된다는 사실을 가입 전에 알려준다.
       */}
      <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3.5">
        <p className="text-[13px] font-bold text-brand-700">
          가입 후 고객센터로 연락 주시면 승인이 빨라집니다
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          신청은 순서대로 확인하지만, 연락을 주시면 바로 확인해 처리해 드립니다.
          <br />
          <span className="font-semibold text-ink">{contactPoint(company)}</span> · {company.hours}
        </p>
      </div>

      <SignupForm />
    </AuthCard>
  );
}
