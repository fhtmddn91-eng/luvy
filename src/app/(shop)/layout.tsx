import { UtilBar } from "@/components/layout/UtilBar";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <UtilBar />
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
