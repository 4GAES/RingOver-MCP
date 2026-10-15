import { expect, test } from "@playwright/test";

test("el admin da acceso a alguien, esa persona entra con Google y luego se le quita", async ({
  page,
  browser,
}) => {
  // Sesión del admin (viene del proyecto setup).
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: "Admin · fijo" })).toContainText("admin@equipo.test");
  await page.getByLabel("Email de la persona").fill("bea@equipo.test");
  await page.getByRole("button", { name: "Dar acceso" }).click();
  await expect(page.getByText("bea@equipo.test")).toBeVisible();

  // Bea entra con Google en otro navegador limpio.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const bea = await ctx.newPage();
  await bea.goto("/");
  const start = await bea.request.get("/auth/google", { maxRedirects: 0 });
  const to = new URL(start.headers().location ?? "");
  to.searchParams.set("como", "bea@equipo.test");
  await bea.goto(to.toString());
  await expect(bea.getByRole("navigation", { name: "Secciones" })).toBeVisible();
  await expect(bea.getByRole("link", { name: "Usuarios" })).toHaveCount(0);

  // El admin le quita el acceso: su sesión deja de valer.
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Quitar el acceso a bea@equipo.test" }).click();
  await expect(page.getByText("bea@equipo.test")).toHaveCount(0);
  expect((await bea.request.get("/api/overview")).status()).toBe(401);
  await ctx.close();
});
