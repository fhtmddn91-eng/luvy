import { contactPoint } from "@/lib/company";
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

      {/* 비밀번호 재발급이 아직 자동화되지 않아 고객센터로 안내한다 */}
      <p className="mt-5 border-t border-line pt-4 text-center text-[12px] leading-relaxed text-muted">
        로그인이 어려우시면 고객센터{" "}
        <span className="font-semibold text-ink-soft">{contactPoint(company)}</span> 으로 문의해주세요.
        <br />
        ({company.hours})
      </p>
    </AuthCard>
  );
}
