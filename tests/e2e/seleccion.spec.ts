import { expect, type Page, test } from "@playwright/test";
import { lastWorkday, loggedIn } from "./helpers";

// Selección múltiple de comerciales: filtra el Resumen y las Llamadas, viaja entre pantallas
// en la URL y este navegador la recuerda.

async function pick(page: Page, names: string[]) {
  await page.getByRole("button", { name: /Todo el equipo|comercial/ }).click();
  const dialog = page.getByRole("dialog", { name: "Elegir comerciales" });
  for (const n of names) await dialog.getByRole("checkbox", { name: new RegExp(n) }).check();
  await dialog.getByRole("button", { name: `Ver ${names.length} comerciales` }).click();
  await expect(dialog).toHaveCount(0);
}

test("elijo dos comerciales: el resumen, la tabla y las llamadas son solo suyos", async ({ page }) => {
  await loggedIn(page);
  await page.goto(`/?desde=${lastWorkday()}`);
  await expect(page.locator("table.team tbody tr")).toHaveCount(4);

  await pick(page, ["Lucía Martín", "Carla Vidal"]);
  await expect(page).toHaveURL(/comerciales=\d+,\d+/);
  await expect(page.getByRole("button", { name: "2 comerciales" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".headline")).toContainText("los 2 comerciales elegidos hicieron");
  const rows = page.locator("table.team tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: /Lucía Martín|Carla Vidal/ })).toHaveCount(2);
  await expect(page.locator("table.team tfoot")).toContainText("Selección");

  // La selección viaja a Llamadas con el periodo.
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Llamadas" }).click();
  await expect(page).toHaveURL(/\/llamadas\?.*comerciales=\d+,\d+/);
  await expect(page.getByRole("button", { name: "2 comerciales" })).toBeVisible();
  const calls = page.locator("table.calls tbody tr");
  await expect(calls.first()).toBeVisible();
  const n = await calls.count();
  expect(n).toBeGreaterThan(0);
  await expect(calls.filter({ hasText: /Lucía Martín|Carla Vidal/ })).toHaveCount(n);
});

test("el navegador recuerda la selección y «Limpiar» vuelve a todo el equipo", async ({ page }) => {
  await loggedIn(page);
  await page.goto(`/?desde=${lastWorkday()}`);
  await pick(page, ["Diego Romero", "Marcos Pardo"]);

  // Sin la selección en la URL, se aplica la última guardada.
  await page.goto(`/?desde=${lastWorkday()}`);
  await expect(page.getByRole("button", { name: "2 comerciales" })).toBeVisible();
  await expect(page).toHaveURL(/comerciales=/);
  await expect(page.locator("table.team tbody tr")).toHaveCount(2);

  await page.getByRole("button", { name: "2 comerciales" }).click();
  const dialog = page.getByRole("dialog", { name: "Elegir comerciales" });
  await dialog.getByRole("button", { name: "Limpiar" }).click();
  await dialog.getByRole("button", { name: "Ver todo el equipo" }).click();
  await expect(page).not.toHaveURL(/comerciales=/);
  await expect(page.locator("table.team tbody tr")).toHaveCount(4);
  await expect(page.locator(".headline")).toContainText("el equipo hizo");
});

test("el buscador del selector filtra por nombre, sin tildes", async ({ page }) => {
  await loggedIn(page);
  await page.getByRole("button", { name: "Todo el equipo" }).click();
  const dialog = page.getByRole("dialog", { name: "Elegir comerciales" });
  await dialog.getByRole("searchbox", { name: "Buscar comercial" }).fill("lucia");
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await expect(dialog).toContainText("Lucía Martín");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
