// Английский словарь. Тип `Dict` следит, чтобы в нём не осталось дыр: забытая
// ветка - ошибка сборки, а не пустое место на экране у пользователя.

import type { Dict } from "../..";
import { analytics } from "./analytics";
import { auth } from "./auth";
import { broker } from "./broker";
import { cert } from "./cert";
import { chat } from "./chat";
import { common } from "./common";
import { format } from "./format";
import { landing } from "./landing";
import { market } from "./market";
import { news } from "./news";
import { profile } from "./profile";
import { rewards } from "./rewards";
import { shell } from "./shell";
import { smart } from "./smart";
import { shop } from "./shop";
import { signals } from "./signals";
import { dialogs, domScreener, journal, pnlCard, terminal } from "./terminal";
import { tools } from "./tools";

export const en: Dict = {
  analytics,
  auth,
  broker,
  cert,
  chat,
  common,
  format,
  landing,
  market,
  news,
  profile,
  rewards,
  shell,
  shop,
  smart,
  signals,
  dialogs,
  domScreener,
  journal,
  pnlCard,
  terminal,
  tools,
};
