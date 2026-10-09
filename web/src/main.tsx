import { render } from "preact";
import { App } from "./app/App";
import { bootTheme } from "./design/theme-runtime";
import "./design/components";

bootTheme();
render(<App />, document.getElementById("app")!);
