/** @format */

import { describe, expect, it } from "vitest";
import { runAfterCommit } from "./afterCommit";

describe("runAfterCommit — الآثار الجانبية ما تقلبش النجاح لخطأ", () => {
  it("بينفّذ كل الآثار حتى لو واحد فشل، ويرجّع الفاشل بس", async () => {
    const ran: string[] = [];
    const reported: string[] = [];
    const failures = await runAfterCommit(
      [
        { label: "a", run: async () => void ran.push("a") },
        { label: "b", run: async () => { throw new Error("smtp down"); } },
        { label: "c", run: () => void ran.push("c") },
      ],
      (f) => void reported.push(f.label),
    );
    expect(ran.sort()).toEqual(["a", "c"]);
    expect(failures.map((f) => f.label)).toEqual(["b"]);
    expect(reported).toEqual(["b"]);
  });

  it("ما بيرميش حتى لو دالة التبليغ نفسها رمت", async () => {
    const failures = await runAfterCommit(
      [{ label: "x", run: () => { throw new Error("boom"); } }],
      () => { throw new Error("logger down"); },
    );
    expect(failures).toHaveLength(1);
  });

  it("بيرجّع قايمة فاضية لما كله نجح", async () => {
    expect(await runAfterCommit([{ label: "ok", run: () => 1 }], () => {})).toEqual([]);
    expect(await runAfterCommit([], () => {})).toEqual([]);
  });
});
