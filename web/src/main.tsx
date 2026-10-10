import { render } from "preact";
import { App } from "./app/App";
import { bootTheme } from "./design/theme-runtime";
import "./design/components";
import { portalBoot } from "./portal/routes";

bootTheme();
portalBoot();
render(<App />, document.getElementById("app")!);
