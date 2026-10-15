import { expect, test } from "@playwright/test";
import { lastWorkday, loggedIn, login } from "./helpers";

test.describe("sin sesión", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pide login y rechaza credenciales malas", async ({ page }) => {
    await login(page, "demo@4geeks.test", "mala");
    await expect(page.getByRole("alert")).toHaveText("Email o contraseña incorrectos");
  });

  test("un usuario de Center sin permiso de llamadas no entra", async ({ page }) => {
    await login(page, "sinacceso@4geeks.test", "demo");
    await expect(page.getByRole("alert")).toContainText("no tiene acceso a los datos de llamadas");
  });

  test("Google: quien no está en la lista no entra", async ({ page }) => {
    await page.goto("/");
    const start = await page.request.get("/auth/google", { maxRedirects: 0 });
    const to = new URL(start.headers().location ?? "");
    to.searchParams.set("como", "desconocida@4geeksacademy.com");
    await page.goto(to.toString());
    await expect(page.getByRole("alert")).toContainText("todavía no tiene acceso");
  });

  test("Google: rechaza cuentas personales", async ({ page }) => {
    await page.goto("/");
    const start = await page.request.get("/auth/google", { maxRedirects: 0 });
    const to = new URL(start.headers().location ?? "");
    to.searchParams.set("como", "alguien@gmail.com");
    await page.goto(to.toString());
    await expect(page.getByRole("alert")).toContainText("@4geeksacademy.com");
  });

  test("cerrar sesión vuelve al login", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Tu cuenta" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("banner").getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
    const res = await page.request.get("/api/overview");
    expect(res.status()).toBe(401);
  });
});

test("el resumen muestra las 9 métricas, la frase y el equipo", async ({ page }) => {
  await loggedIn(page);
  await page.goto(`/?desde=${lastWorkday()}`);
  await expect(page.locator(".kpi")).toHaveCount(9);
  for (const name of [
    "Llamadas",
    "Llamadas nuevas",
    "Llamadas antiguas",
    "Tiempo en llamada",
    "Tiempo al teléfono",
    "Tiempo conectado",
    "Llamadas de +15 min",
    "Llamadas de menos de 5 min",
    "Nuevas de +15 min",
  ]) {
    await expect(
      page.locator(".kpi-label", { hasText: new RegExp(`^${name.replace("+", "\\+")}$`) }),
    ).toHaveCount(1);
  }
  await expect(page.locator(".headline")).toContainText("el equipo hizo");
  await expect(page.locator("table.team tbody tr")).toHaveCount(4);
  await expect(page.getByText("Comparado con")).toBeVisible();
});

test("los presets y las flechas cambian el periodo en la URL", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Semana", exact: true }).click();
  await expect(page).toHaveURL(/desde=/);
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  await expect(page).not.toHaveURL(/desde=/);
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/desde=/);
});

test("la ficha de un comercial enseña su jornada y sus llamadas", async ({ page }) => {
  await loggedIn(page);
  await page.goto(`/?desde=${lastWorkday()}`);
  await page.locator("table.team tbody tr").first().click();
  await expect(page).toHaveURL(/\/comercial\/\d+/);
  await expect(page.getByRole("heading", { level: 2, name: "Jornada" })).toBeVisible();
  await expect(page.locator(".timeline svg")).toBeVisible();
  await expect(page.locator("table.calls tbody tr").first()).toBeVisible();
});

test("el listado filtra por llamadas nuevas y abre el historial de un número", async ({ page }) => {
  await loggedIn(page);
  await page.goto(`/llamadas?desde=${lastWorkday()}`);
  await page.getByLabel("Tipo").selectOption("nuevas");
  await expect(page).toHaveURL(/tipo=nuevas/);
  const chips = page.locator("table.calls tbody .chip", { hasText: /Nueva|Antigua/ });
  await expect(chips.first()).toHaveText("Nueva");
  expect(await chips.filter({ hasText: "Antigua" }).count()).toBe(0);
  await page.locator(".contact button").first().click();
  await expect(page.getByRole("dialog")).toContainText("llamada");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("la insignia «Destroy this website» solo está en la landing (ni en el panel ni en el acceso)", async ({
  page,
  baseURL,
}) => {
  await loggedIn(page);
  await expect(page.locator(".destroy-badge")).toHaveCount(0);
  const ctx = await page
    .context()
    .browser()
    ?.newContext({ storageState: { cookies: [], origins: [] } });
  const anon = await ctx?.newPage();
  if (!anon) throw new Error("sin contexto");
  await anon.goto(`${baseURL}/`);
  const badge = anon.locator("footer .destroy-badge");
  await expect(badge).toHaveAttribute(
    "href",
    `https://destroy.spritefusion.com/?from=badge&url=${encodeURIComponent(new URL(baseURL ?? "").origin)}`,
  );
  await expect(badge.locator("img:visible")).toHaveCount(1);
  await anon.getByRole("banner").getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(anon.getByRole("dialog").locator(".destroy-badge")).toHaveCount(0);
  await ctx?.close();
});

test("con sesión, /privacidad sigue mostrando la política (no el panel)", async ({ page }) => {
  await loggedIn(page);
  await page.goto("/privacidad");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Política de privacidad");
  await expect(page.getByRole("region", { name: "Aviso de cookies" })).toBeVisible();
});
