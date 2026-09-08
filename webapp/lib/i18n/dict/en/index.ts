// Английский словарь. Тип `Dict` следит, чтобы в нём не осталось дыр: забытая
// ветка - ошибка сборки, а не пустое место на экране у пользователя.

import type { Dict } from "../..";
import { analytics } from "./analytics";
import { auth } from "./auth";
import { chat } from "./chat";
import { common } from "./common";
import { format } from "./format";
import { landing } from "./landing";
import { market } from "./market";
import { news } from "./news";
import { profile } from "./profile";
import { shell } from "./shell";
import { smart } from "./smart";
import { shop } from "./shop";
import { signals } from "./signals";
import { tools } from "./tools";

export const en: Dict = {
  analytics,
  auth,
  chat,
  common,
  format,
  landing,
  market,
  news,
  profile,
  shell,
  shop,
  smart,
  signals,
  tools,
};
