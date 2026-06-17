import {
  SiTelegram,
  SiTiktok,
  SiThreads,
} from "@icons-pack/react-simple-icons";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { SOCIAL_LINKS } from "@/lib/content";

const SOCIALS = [
  { name: "Telegram", handle: "@nmnh", href: SOCIAL_LINKS.telegram, color: "#229ED9", Icon: SiTelegram },
  { name: "Threads", handle: "@nmnh", href: SOCIAL_LINKS.threads, color: "#FFFFFF", Icon: SiThreads },
  { name: "TikTok", handle: "@nmnh", href: SOCIAL_LINKS.tiktok, color: "#25F4EE", Icon: SiTiktok },
];

export default function Socials() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow="Соцсети" title="Будь в курсе сделок" />

      <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
        {SOCIALS.map((s, i) => {
          const { Icon } = s;
          return (
            <Reveal key={s.name} delay={i * 0.08}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.16] hover:bg-white/[0.07]"
              >
                <span
                  className="grid h-12 w-12 place-items-center rounded-xl ring-1 ring-white/[0.08] transition group-hover:scale-110"
                  style={{ color: s.color, background: "rgba(255,255,255,0.04)" }}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <div className="font-semibold text-white">{s.name}</div>
                  <div className="text-sm text-text-muted">{s.handle}</div>
                </div>
              </a>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
