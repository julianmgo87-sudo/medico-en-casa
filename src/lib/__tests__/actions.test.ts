import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { num } from "@/lib/actions";

const fd = (v: string) => { const f = new FormData(); f.set("x", v); return f; };

describe("lectura de números en formularios", () => {
  it("entiende separadores de miles colombianos", () => expect(num(fd("100.000"), "x")).toBe(100000));
  it("entiende decimales con coma o punto", () => {
    expect(num(fd("12,5"), "x")).toBe(12.5);
    expect(num(fd("12.5"), "x")).toBe(12.5);
  });
  it("vacío es null", () => expect(num(fd(""), "x")).toBeNull());
  it("rechaza texto", () => expect(() => num(fd("abc"), "x")).toThrow());
});
