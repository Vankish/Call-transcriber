import { describe, expect, test } from "vitest";

import { checkRedirect, DESKTOP_AUTH_CALLBACK } from "./authRedirect";

const SITE = "https://web.example.com/";

describe("a dónde se vuelve tras entrar con Google", () => {
  test("la vuelta de la app de escritorio, exactamente esa", () => {
    expect(checkRedirect(DESKTOP_AUTH_CALLBACK, SITE)).toBe("http://localhost:3000/convex-auth");
    for (const near of [
      "http://localhost:3000/convex-auth/otra",
      "http://localhost:3000/convex-auth?x=1",
      "http://localhost:3001/convex-auth",
      "http://localhost:3000/",
      "https://localhost:3000/convex-auth",
    ]) {
      expect(() => checkRedirect(near, SITE)).toThrow(/no está permitida/);
    }
  });

  test("relativas, contra SITE_URL", () => {
    expect(checkRedirect("/i/abc", SITE)).toBe("https://web.example.com/i/abc");
    expect(checkRedirect("?entrar=1", SITE)).toBe("https://web.example.com?entrar=1");
    expect(() => checkRedirect("//otra.com/x", SITE)).toThrow(/no está permitida/);
  });

  test("las que empiezan por SITE_URL, y nada que solo se le parezca", () => {
    expect(checkRedirect("https://web.example.com", SITE)).toBe("https://web.example.com");
    expect(checkRedirect("https://web.example.com/l/x", SITE)).toBe("https://web.example.com/l/x");
    for (const bad of [
      "https://web.example.com.otra.com/",
      "https://otra.com/?https://web.example.com",
      "javascript:alert(1)",
      "",
    ]) {
      expect(() => checkRedirect(bad, SITE)).toThrow(/no está permitida/);
    }
  });

  test("sin SITE_URL solo vale la de la app", () => {
    expect(() => checkRedirect("/i/abc", undefined)).toThrow(/no está permitida/);
    expect(checkRedirect(DESKTOP_AUTH_CALLBACK, undefined)).toBe(DESKTOP_AUTH_CALLBACK);
  });
});
