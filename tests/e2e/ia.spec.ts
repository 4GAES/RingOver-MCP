import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const mcp = (token: string, body: unknown) => ({
  headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" },
  data: body,
});
const INIT = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-cliente", version: "1.0" },
  },
};

test("genero un token en el panel, lo uso desde una IA y aparece en Actividad y Consumo", async ({
  page,
  request,
}) => {
  await page.goto("/ia?tab=tokens");
  await page.getByRole("button", { name: "Nuevo token" }).click();
  await page.getByLabel("Nombre (para reconocerlo luego)").fill("Token E2E");
  await page.getByRole("button", { name: "Crear token" }).click();
  const token = (await page.locator(".token-ready .code pre").first().textContent())?.trim() ?? "";
  expect(token).toMatch(/^rgo_p_/);
  await page.getByRole("button", { name: "Hecho" }).click();
  await expect(page.locator("tbody tr", { hasText: "Token E2E" }).first()).toBeVisible();

  expect((await request.post("/mcp", mcp(token, INIT))).ok()).toBe(true);
  const res = await request.post(
    "/mcp",
    mcp(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "alertas", arguments: {} } }),
  );
  expect(res.ok()).toBe(true);

  await page.goto("/ia?tab=actividad");
  const row = page.locator("tbody tr", { hasText: "alertas" }).first();
  await expect(row).toContainText("e2e-cliente 1.0");
  await expect(row).toContainText("Correcta");
  await row.click();
  await expect(page.getByRole("dialog", { name: "Detalle de la consulta" })).toContainText("Token E2E");
  await page.keyboard.press("Escape");

  await page.goto("/ia?tab=consumo&ver=equipo");
  await expect(page.locator(".stat-label", { hasText: /^Consultas$/ })).toBeVisible();
  await expect(page.locator("td", { hasText: "alertas" }).first()).toBeVisible();
});

test("OAuth: una app se registra, pido acceso, pulso Permitir y la conexión funciona", async ({
  page,
  request,
}) => {
  const reg = await (
    await request.post("/oauth/register", {
      data: { client_name: "Cliente E2E", redirect_uris: ["http://localhost:9/cb"] },
    })
  ).json();
  const verifier = "e2e-verifier-".repeat(5);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: "http://localhost:9/cb",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "e2e",
  });
  let landed = "";
  await page.route("http://localhost:9/**", (r) => {
    landed = r.request().url();
    return r.fulfill({ body: "ok" });
  });
  await page.goto(`/oauth/authorize?${q}`);
  await expect(page.getByRole("heading", { name: "Cliente E2E quiere conectarse" })).toBeVisible();
  await page.getByRole("button", { name: "Permitir acceso" }).click();
  await expect.poll(() => landed).toContain("code=");
  const back = new URL(landed);
  expect(back.searchParams.get("state")).toBe("e2e");

  const tok = await (
    await request.post("/oauth/token", {
      form: {
        grant_type: "authorization_code",
        code: back.searchParams.get("code") ?? "",
        client_id: reg.client_id,
        redirect_uri: "http://localhost:9/cb",
        code_verifier: verifier,
      },
    })
  ).json();
  expect(tok.token_type).toBe("Bearer");
  expect((await request.post("/mcp", mcp(tok.access_token, INIT))).ok()).toBe(true);

  await page.goto("/ia?tab=tokens");
  await expect(page.locator("tr", { hasText: "Cliente E2E" })).toContainText("Conexión OAuth");
});

test("«Qué puede hacer» enseña qué herramientas aceptan un grupo y ejemplos con nombres del equipo", async ({
  page,
}) => {
  await page.goto("/ia");
  const resumen = page.locator(".card.tool", { hasText: "Resumen de llamadas" });
  await expect(resumen.locator(".tool-param.group")).toHaveText("Grupo de comerciales");
  await expect(
    page.locator(".card.tool", { hasText: "Historial de un número" }).locator(".tool-param.group"),
  ).toHaveCount(0);
  await expect(page.locator(".card.tool", { hasText: "Revisar a un grupo" })).toBeVisible();
  // Los ejemplos usan comerciales reales del equipo (los de la demo).
  await expect(page.locator(".example", { hasText: /¿Cómo van esta semana .+ juntos\?/ })).toContainText(
    /Carla|Diego|Lucía|Marcos/,
  );
});
