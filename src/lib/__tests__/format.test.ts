import { describe, expect, it } from "vitest";
import { addDays, bogotaDate, formatCOP } from "@/lib/format";

describe("formato", () => {
  it("formatea pesos colombianos sin decimales", () => {
    expect(formatCOP(140000).replace(/\s/g, " ")).toMatch(/\$ ?140\.000/);
  });
  it("usa la fecha de Bogotá (UTC−5)", () => {
    expect(bogotaDate(new Date("2026-10-22T03:00:00Z"))).toBe("2026-10-21");
  });
  it("suma días cruzando de mes", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});
