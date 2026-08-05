import { requireAdmin } from "@/lib/auth";
import { getShippingPolicy, getLogoUrl } from "@/lib/settings";
import { getCompany } from "@/lib/companyInfo";
import {
  ShippingSettingsForm,
  AdminPasswordForm,
  LogoForm,
  CompanyInfoForm,
  BankAccountForm,
} from "@/components/admin/SettingsForms";
import { getBankAccount } from "@/lib/bankAccountInfo";
import { PageHeader, Panel } from "@/components/ui/Panel";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [policy, logo, company, bank] = await Promise.all([
    getShippingPolicy(),
    getLogoUrl(),
    getCompany(),
    getBankAccount(),
  ]);

  return (
    <div className="max-w-[560px]">
      <PageHeader
        eyebrow="System"
        title="설정"
        description="로고 · 사업자 정보 · 입금 계좌 · 배송비 정책 · 관리자 계정"
      />

      <div className="space-y-4">
        <div className="rise rise-1">
          <Panel title="로고">
            <LogoForm current={logo} />
          </Panel>
        </div>

        <div className="rise rise-2">
          <Panel title="사업자 · 고객센터 정보">
            <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
              푸터, 이용약관, 개인정보처리방침, 로그인·가입 안내에 그대로 들어갑니다.
              전자상거래법상 표시 의무 항목이라 상호·대표자·사업자등록번호·이메일은
              비울 수 없습니다.
            </p>
            <CompanyInfoForm current={company} />
          </Panel>
        </div>

        <div className="rise rise-3">
          <Panel title="무통장입금 계좌">
            <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
              주문서와 주문 완료 화면의 입금 안내에 그대로 들어갑니다.
            </p>
            <BankAccountForm current={bank} />
          </Panel>
        </div>

        <div className="rise rise-3">
          <Panel title="배송비">
            <ShippingSettingsForm fee={policy.fee} freeThreshold={policy.freeThreshold} />
          </Panel>
        </div>

        <div className="rise rise-3">
          <Panel title="관리자 비밀번호">
            <AdminPasswordForm />
            <p className="mt-3 border-t border-hairline-soft pt-3 text-[12px] leading-relaxed text-muted">
              Railway 의 <code className="font-display">ADMIN_PW</code> 환경변수는 계정이
              없을 때 처음 만드는 용도로만 쓰입니다. 여기서 바꾼 비밀번호는 재배포해도
              유지됩니다. (비밀번호를 완전히 잊었을 때는{" "}
              <code className="font-display">ADMIN_PW_FORCE=1</code> 을 추가하고 재배포하면
              환경변수 값으로 다시 덮어씁니다)
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
