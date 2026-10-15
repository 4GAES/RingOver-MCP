import { expect, test } from "@playwright/test";
import { lastWorkday, loggedIn, offscreen } from "./helpers";

for (const path of ["/", "/llamadas", "/comercial/101", "/ia", "/ia?tab=consumo"]) {
  test(`sin scroll horizontal en el móvil: ${path}`, async ({ page }) => {
    await loggedIn(page);
    await page.goto(`${path}${path.includes("?") ? "&" : "?"}desde=${lastWorkday()}`);
    await page.waitForLoadState("networkidle");
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(sw).toBeLessThanOrEqual(cw);
  });
}

test.describe("landing en el móvil", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const path of ["/", "/aviso-legal", "/privacidad", "/cookies"]) {
    test(`sin scroll horizontal: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("region", { name: "Aviso de cookies" })).toBeVisible();
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(sw).toBeLessThanOrEqual(cw);
      expect(await offscreen(page)).toEqual([]);
    });
  }
});

test("en el móvil, el selector de comerciales es una hoja a todo el ancho", async ({ page }) => {
  await loggedIn(page);
  await page.goto(`/?desde=${lastWorkday()}`);
  await page.getByRole("button", { name: "Todo el equipo" }).click();
  const sheet = page.getByRole("dialog", { name: "Elegir comerciales" });
  const box = await sheet.boundingBox();
  const vw = page.viewportSize()?.width ?? 0;
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vw);
  expect(box?.width).toBeGreaterThan(vw - 40);
  await sheet.getByRole("checkbox", { name: /Lucía Martín/ }).check();
  await sheet.getByRole("button", { name: "Ver 1 comercial" }).click();
  await expect(page.locator(".headline")).toContainText("Lucía Martín");
});
