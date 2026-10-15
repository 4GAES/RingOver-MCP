import { expect, test } from "@playwright/test";
import { offscreen } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("la portada sin sesión es la landing del producto, ya renderizada en el servidor", async ({
  page,
  request,
}) => {
  // Lo que ve un rastreador sin JavaScript (Google, GPTBot, ClaudeBot…).
  const html = await (await request.get("/")).text();
  expect(html).toContain("Analítica de llamadas e IA para Ringover");
  expect(html).toContain('"@type":"FAQPage"');
  expect(html).toContain('rel="canonical"');
  expect(html).not.toContain("noindex");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Analítica de llamadas e IA para Ringover",
  );
  await expect(page.getByRole("heading", { name: "Lo que suelen preguntarnos" })).toBeVisible();
  await expect(page.getByText("no está afiliado ni respaldado por Ringover")).toBeVisible();
});

test("robots.txt, sitemap.xml y llms.txt están publicados", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("User-agent: GPTBot");
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toContain("Sitemap: https://ringover.duckdns.org/sitemap.xml");
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "<loc>https://ringover.duckdns.org/</loc>",
  );
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toMatch(/^# Ringover 4Geeks/);
  expect(llms).toContain("¿Es un producto oficial de Ringover?");
  expect((await request.get("/og.png")).headers()["content-type"]).toContain("image/png");
});

test("el formulario de acceso se envía y confirma", async ({ page }) => {
  await page.goto("/#acceso");
  const form = page.getByRole("form", { name: "Solicitar acceso a Ringover 4Geeks" });
  await form.getByLabel("Nombre").fill("Ana Pérez");
  await form.getByLabel("Email de trabajo").fill("ana@empresa.test");
  await form.getByLabel("Empresa").fill("Empresa Test");
  await form.getByLabel("Tamaño del equipo comercial").selectOption("6-20");
  await expect(form).toContainText("Responsable: 4Geeks Academy España S.L.");
  await form.getByLabel(/He leído la política de privacidad/).check();
  await form.getByRole("button", { name: "Solicitar acceso" }).click();
  await expect(page.getByRole("status")).toContainText("¡Recibido, Ana!");
});

test("«Entrar» de la cabecera abre el acceso sin salir de la landing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("button", { name: "Entrar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Entra en tu panel" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("aviso legal, privacidad y cookies: ya renderizadas, indexables y enlazadas desde el pie", async ({
  page,
  request,
}) => {
  for (const [path, h1] of [
    ["/aviso-legal", "Aviso legal"],
    ["/privacidad", "Política de privacidad"],
    ["/cookies", "Política de cookies"],
  ] as const) {
    const res = await request.get(path);
    expect(res.headers()["x-robots-tag"]).toBeUndefined();
    const html = await res.text();
    expect(html).toContain(`<h1>${h1}</h1>`);
    expect(html).toContain(`<link rel="canonical" href="https://ringover.duckdns.org${path}"`);
    expect(html).not.toContain("noindex");
  }
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "<loc>https://ringover.duckdns.org/privacidad</loc>",
  );

  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Aviso legal" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aviso legal");
  await expect(page.getByText("B88579495")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Textos legales" })
    .getByRole("link", { name: "Cookies" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Política de cookies");
  await expect(page.getByRole("cell", { name: "rg_sid" })).toBeVisible();
  await expect(page.locator(".destroy-badge")).toHaveCount(0);
});

test("el aviso de cookies informa, se cierra y no vuelve; ver la landing no instala cookies", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const notice = page.getByRole("region", { name: "Aviso de cookies" });
  await expect(notice).toContainText("Solo cookies técnicas");
  await page.waitForLoadState("networkidle");
  expect(await context.cookies()).toEqual([]);
  await notice.getByRole("button", { name: "Entendido" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(notice).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);
});

test("«Entrar» desde una página legal abre el acceso en la portada", async ({ page }) => {
  await page.goto("/privacidad");
  await page.getByRole("banner").getByRole("link", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Entra en tu panel" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Privacidad" })).toHaveAttribute(
    "href",
    "/privacidad",
  );
});

for (const width of [320, 375, 768, 1024, 1280]) {
  test(`a ${width} px no se corta nada (landing y páginas legales)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/privacidad", "/cookies"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await offscreen(page), path).toEqual([]);
    }
  });
}

test("en el móvil, el menú lleva a las secciones y a «Entrar»", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header.getByRole("navigation", { name: "Contenido de la página" })).toBeHidden();
  await expect(header.getByRole("link", { name: "Solicitar acceso" })).toBeVisible();
  await header.getByRole("button", { name: "Abrir menú" }).click();
  const menu = page.getByRole("navigation", { name: "Menú" });
  await menu.getByRole("link", { name: "Preguntas" }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/#preguntas$/);
  await header.getByRole("button", { name: "Abrir menú" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await header.getByRole("button", { name: "Abrir menú" }).click();
  await menu.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Entra en tu panel" })).toBeVisible();
});
