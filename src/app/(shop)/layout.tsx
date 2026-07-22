import { UtilBar } from "@/components/layout/UtilBar";
import { Header } from "@/components/layout/Header";
import { CategoryBar } from "@/components/layout/CategoryBar";
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
      <CategoryBar />
      <main>{children}</main>
      <Footer />
    </>
  );
}
