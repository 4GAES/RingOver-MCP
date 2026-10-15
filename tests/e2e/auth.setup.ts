import { expect, test as setup } from "@playwright/test";
import { AUTH } from "../../playwright.config";
import { openLogin } from "./helpers";

setup("entrar con Google como admin", async ({ page }) => {
  await openLogin(page);
  await page.getByRole("dialog").getByRole("link", { name: "Continuar con Google" }).click();
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
  await page.context().storageState({ path: AUTH });
});
