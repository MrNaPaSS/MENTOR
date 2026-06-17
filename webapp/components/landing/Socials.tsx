import { SiTelegram } from "@icons-pack/react-simple-icons";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { SOCIAL_LINKS } from "@/lib/content";

const SOCIALS = [
  { name: "КАНАЛ", href: SOCIAL_LINKS.telegram, Icon: SiTelegram },
  { name: "АКАДЕМИЯ", href: "https://t.me/moneyhoney7_bot", Icon: SiTelegram },
];

export default function Socials() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow="Соцсети" title="Будь в курсе сделок" />

      <div className="mt-12 flex justify-center gap-4">
        {SOCIALS.map((s, i) => {
          const { Icon } = s;
          return (
            <Reveal key={s.name} delay={i * 0.1}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-52 flex-col gap-5 rounded-2xl border border-white/[0.18] bg-white/[0.08] p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#229ED9]/50 hover:bg-white/[0.13]"
              >
                <span
                  className="grid h-12 w-12 place-items-center rounded-xl ring-1 ring-[#229ED9]/30 transition group-hover:scale-110"
                  style={{ color: "#229ED9", background: "rgba(34,158,217,0.10)" }}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <div className="text-base font-bold tracking-widest text-white">
                  {s.name}
                </div>
              </a>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
