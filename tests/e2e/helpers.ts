import { expect, type Page } from "@playwright/test";
import { addDays, localDay, weekday } from "../../src/shared/time";

/** Abre el acceso desde la cabecera de la landing. */
export async function openLogin(page: Page) {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

export async function login(page: Page, email = "demo@4geeks.test", password = "demo") {
  await openLogin(page);
  await page.getByLabel("Email de 4Geeks Center").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("dialog").getByRole("button", { name: "Entrar al panel" }).click();
}

/** La sesión ya viene del proyecto "setup"; solo se comprueba que sigue viva. */
export async function loggedIn(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
}

/** Último día laborable cerrado (los datos de demo no tienen domingos). */
export function lastWorkday(): string {
  let d = addDays(localDay(Date.now()), -1);
  while (weekday(d) >= 5) d = addDays(d, -1);
  return d;
}

/**
 * Elementos visibles que se salen por los lados de la pantalla. La landing recorta el
 * desbordamiento (overflow-x: clip), así que el scroll horizontal no basta para detectarlo:
 * hay que mirar si algo queda cortado. Ignora lo decorativo y lo que vive dentro de un
 * contenedor con su propio scroll.
 */
export async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = new Set<string>();
    for (const el of document.querySelectorAll<HTMLElement>(".lp *")) {
      if (el.closest("[aria-hidden='true'], [hidden]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).position === "fixed") continue;
      if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
      let a = el.parentElement;
      let scrolls = false;
      while (a && !a.classList.contains("lp")) {
        if (/auto|scroll/.test(getComputedStyle(a).overflowX)) scrolls = true;
        a = a.parentElement;
      }
      if (!scrolls) out.add(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(r.right)}px`);
    }
    return [...out].slice(0, 10);
  });
}
