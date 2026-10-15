import { z } from "zod";

// La API de Ringover devuelve muchos campos opcionales y a veces null: validamos solo
// lo que usamos y dejamos pasar el resto sin romper.
const num = z.coerce.number();
const optNum = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), "no es un número");
const optStr = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const ringoverUser = z
  .object({
    user_id: num,
    firstname: optStr,
    lastname: optStr,
    concat_name: optStr,
    email: optStr,
    initial: optStr,
    color: optStr,
    picture: optStr,
  })
  .loose();
export type RingoverUser = z.infer<typeof ringoverUser>;

const contact = z
  .object({
    firstname: optStr,
    lastname: optStr,
    concat_name: optStr,
    company: optStr,
  })
  .loose()
  .nullable()
  .optional();

const tag = z.object({ name: optStr }).loose();

export const ringoverCall = z
  .object({
    cdr_id: num,
    call_id: optStr,
    type: optStr,
    direction: z.string(),
    is_answered: z.coerce.boolean(),
    last_state: optStr,
    start_time: z.string(),
    answered_time: optStr,
    end_time: optStr,
    incall_duration: optNum,
    total_duration: optNum,
    ringing_duration: optNum,
    hold_duration: optNum,
    queue_duration: optNum,
    hangup_by: optStr,
    contact_number: optStr,
    from_number: optStr,
    to_number: optStr,
    record: optStr,
    tags: z.array(tag).nullable().optional(),
    user: ringoverUser.nullable().optional(),
    contact,
  })
  .loose();
export type RingoverCall = z.infer<typeof ringoverCall>;

export const callsPage = z
  .object({
    total_call_count: optNum,
    call_list_count: optNum,
    call_list: z.array(z.unknown()).nullable().optional(),
  })
  .loose();

export const presence = z
  .object({
    user_id: num,
    in_call: z.coerce.boolean().optional(),
    connected_devices: optNum,
    is_snoozed: z.coerce.boolean().optional(),
  })
  .loose();
export type Presence = z.infer<typeof presence>;

/** Busca la primera lista de objetos dentro de una respuesta (la forma varía por endpoint). */
export function firstArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const v of Object.values(body)) if (Array.isArray(v)) return v;
    for (const v of Object.values(body)) {
      if (v && typeof v === "object") {
        const inner = firstArray(v);
        if (inner.length) return inner;
      }
    }
  }
  return [];
}
