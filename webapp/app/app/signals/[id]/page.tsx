import dynamic from "next/dynamic";

const SignalDetail = dynamic(() => import("./SignalDetail"), { ssr: false });

export async function generateStaticParams() {
  return [];
}

export default function Page() {
  return <SignalDetail />;
}
