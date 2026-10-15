import { expect, test } from "@playwright/test";

const TOKEN = "e2e-token-solo-pruebas-000000000000000";
const headers = { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" };

test("el MCP responde con datos reales de la base", async ({ request }) => {
  const call = (id: number, method: string, params?: unknown) =>
    request.post("/mcp", { headers, data: { jsonrpc: "2.0", id, method, params } });
  expect(
    (
      await call(0, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1" },
      })
    ).ok(),
  ).toBe(true);
  const res = await (await call(1, "tools/call", { name: "comerciales", arguments: {} })).json();
  const data = JSON.parse(res.result.content[0].text);
  expect(data.comerciales).toHaveLength(4);
  const rank = await (
    await call(2, "tools/call", {
      name: "ranking",
      arguments: { metrica: "mas15", desde: "2026-09-01", hasta: "2026-09-30" },
    })
  ).json();
  expect(JSON.parse(rank.result.content[0].text).ranking[0].puesto).toBe(1);
});

test("el MCP sin token devuelve 401", async ({ request }) => {
  const res = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(res.status()).toBe(401);
});
