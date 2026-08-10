import { getCompany } from "@/lib/companyInfo";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const company = await getCompany();
  return (
    <AuthCard
      title="러비 로그인"
      subtitle="로그인 후 상품 열람 및 구매가 가능합니다."
      footer={
        <>
          아직 회원이 아니신가요?{" "}
          <Link href="/signup" className="font-semibold text-brand-600 hover:underline">
            회원가입
          </Link>
        </>
      }
    >
      <LoginForm next={next ?? "/"} />

      {/*
       * 가입 신청을 실시간으로 지켜볼 수 없어, 연락을 주면 바로 승인된다는 걸
       * 로그인 화면에서도 알린다 — 가입 직후 여기로 되돌아오는 회원이 많다.
       */}
      <div className="mt-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3.5">
        <p className="text-[13px] font-bold text-brand-700">
          회원가입 후 고객센터로 꼭 연락 주세요
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          승인 요청을 실시간으로 확인하기 어렵습니다. 가입 후 연락 주시면 더 빠르게
          승인해 드립니다.
        </p>
      </div>

      {/*
       * 승인 문의처는 전화·이메일을 함께 보여준다 — 연락 수단이 하나만 뜨면
       * 그쪽이 안 될 때 되돌아갈 곳이 없다(전화가 없으면 이메일만 나온다).
       */}
      <p className="mt-4 border-t border-line pt-4 text-center text-[12px] leading-relaxed text-muted">
        고객센터{" "}
        {company.tel && (
          <>
            <span className="font-semibold text-ink-soft">{company.tel}</span>
            {" · "}
          </>
        )}
        <span className="font-semibold text-ink-soft">{company.email}</span>
        <br />
        ({company.hours})
      </p>
    </AuthCard>
  );
}
