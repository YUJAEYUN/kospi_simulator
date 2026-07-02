import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "코스피 지수 시뮬레이터",
  description:
    "전일 종가 기준 코스피 구성종목 데이터로, 특정 종목의 가격을 임의로 바꿨을 때 코스피 지수가 어떻게 변하는지 시뮬레이션합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col bg-[#F2F4F6] text-[#191F28] antialiased">
        {children}
      </body>
    </html>
  );
}
