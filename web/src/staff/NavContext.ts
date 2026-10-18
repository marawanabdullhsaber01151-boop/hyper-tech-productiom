import { createContext } from "preact";
import type { NavResponse } from "./nav";

/** الشِل بيحمّل /nav مرة واحدة، والصفحات (زي Home) بتقراه من هنا بدل ما تطلبه تاني. */
export const NavContext = createContext<NavResponse | undefined>(undefined);
