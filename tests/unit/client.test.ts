import { describe, expect, it, vi } from "vitest";
import { RingoverClient, RingoverError } from "../../src/server/ringover/client";
import { call } from "./helpers";

function fakeFetch(responses: (() => Response)[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: URL | string) => {
    calls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error("sin respuesta preparada");
    return next();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

function client(fetchImpl: typeof fetch) {
  const sleeps: number[] = [];
  let t = 0;
  const c = new RingoverClient({
    apiKey: "k",
    baseUrl: "https://api.test/v2",
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  });
  return { c, sleeps };
}

describe("cliente de Ringover", () => {
  it("reintenta un 429 respetando Retry-After", async () => {
    const f = fakeFetch([json({}, 429, { "retry-after": "2" }), json({ call_list: [] })]);
    const { c, sleeps } = client(f.impl);
    await c.callsBetween(0, 1000);
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toContain(2000);
  });

  it("no reintenta un 401 (clave inválida)", async () => {
    const f = fakeFetch([json({}, 401)]);
    const { c } = client(f.impl);
    await expect(c.callsBetween(0, 1000)).rejects.toMatchObject({ status: 401 });
    expect(f.calls).toHaveLength(1);
  });

  it("abre el cortacircuitos tras varios fallos seguidos", async () => {
    const f = fakeFetch(Array.from({ length: 18 }, () => json({}, 503)));
    const { c } = client(f.impl);
    for (let i = 0; i < 3; i++) await expect(c.users()).rejects.toBeInstanceOf(RingoverError);
    const before = f.calls.length;
    await expect(c.users()).rejects.toThrow(/pausa de seguridad/);
    expect(f.calls.length).toBe(before);
  });

  it("pagina hasta la última página y descarta llamadas mal formadas", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      call({ start: "2026-10-02T08:00:00Z", cdr_id: i + 1 } as never),
    );
    const f = fakeFetch([
      json({ call_list: page1 }),
      json({ call_list: [{ roto: true }, call({ start: "2026-10-02T09:00:00Z" })] }),
    ]);
    const { c } = client(f.impl);
    const out = await c.callsBetween(0, 1000);
    expect(out).toHaveLength(1001);
    expect(f.calls[1]).toContain("limit_offset=1000");
    expect(f.calls[0]).toContain("start_date=1970-01-01T00%3A00%3A00Z");
  });

  it("encuentra la lista de presencias aunque cambie el envoltorio", async () => {
    const f = fakeFetch([
      json({ data: { presences: [{ user_id: "5", connected_devices: 2, is_snoozed: 0 }] } }),
    ]);
    const { c } = client(f.impl);
    expect(await c.presences()).toMatchObject([{ user_id: 5, connected_devices: 2, is_snoozed: false }]);
  });
});
