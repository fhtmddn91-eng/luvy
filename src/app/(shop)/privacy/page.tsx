const sections: { title: string; body: string }[] = [
  {
    title: "1. 수집하는 개인정보 항목",
    body: "회사는 회원 가입, 주문·배송, 고객 상담을 위해 아래 정보를 수집합니다.\n· 필수: 이메일, 비밀번호, 상호명, 사업자등록번호, 대표자명, 연락처\n· 주문 시: 수령인, 배송지 주소, 연락처, 결제 기록\n· 자동 수집: 접속 로그, 쿠키, 접속 IP",
  },
  {
    title: "2. 개인정보의 수집·이용 목적",
    body: "· 사업자 회원 자격 확인 및 가입 승인 심사\n· 주문·결제·배송 등 계약 이행\n· 고객 문의 응대 및 공지사항 전달\n· 부정 이용 방지 및 서비스 개선",
  },
  {
    title: "3. 보유 및 이용 기간",
    body: "회원 탈퇴 시 지체 없이 파기합니다. 단, 관계 법령에 따라 아래 기간 동안 보관합니다.\n· 계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래법)\n· 대금결제 및 재화 공급에 관한 기록: 5년 (전자상거래법)\n· 소비자 불만 또는 분쟁처리에 관한 기록: 3년 (전자상거래법)\n· 접속 기록: 3개월 (통신비밀보호법)",
  },
  {
    title: "4. 개인정보의 제3자 제공",
    body: "회사는 원칙적으로 회원의 개인정보를 외부에 제공하지 않습니다. 다만 배송을 위한 택배사 제공(수령인·주소·연락처), 결제 처리를 위한 전자결제대행사 제공, 법령에 의한 요청의 경우는 예외로 합니다.",
  },
  {
    title: "5. 개인정보 처리 위탁",
    body: "· 결제 처리: NHN KCP (전자결제대행)\n· 서버 운영: 클라우드 인프라 제공사\n위탁 계약 시 개인정보 보호 관련 법규 준수를 명시하고 관리·감독합니다.",
  },
  {
    title: "6. 정보주체의 권리",
    body: "회원은 언제든지 자신의 개인정보를 조회·수정하거나 삭제(탈퇴)를 요청할 수 있습니다. 고객센터(1600-0000) 또는 1:1 문의를 통해 요청하시면 지체 없이 조치합니다.",
  },
  {
    title: "7. 개인정보의 파기 절차 및 방법",
    body: "보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 전자적 파일은 복구 불가능한 방법으로 삭제하고, 출력물은 분쇄 또는 소각하여 파기합니다.",
  },
  {
    title: "8. 개인정보 보호책임자",
    body: "· 성명: 000\n· 직책: 개인정보 보호책임자\n· 연락처: 1600-0000, privacy@luvyb2b.com\n개인정보 관련 문의·불만·피해구제는 위 연락처로 접수할 수 있습니다.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <h1 className="text-[26px] font-extrabold text-ink sm:text-[28px]">개인정보처리방침</h1>
      <p className="mb-8 mt-1 text-[13px] text-muted">시행일: 2026년 1월 1일</p>

      <div className="space-y-6 rounded-2xl border border-line bg-white p-5 sm:p-8">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 text-[15px] font-bold text-ink">{s.title}</h2>
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
