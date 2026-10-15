import { openDb } from "../../src/server/db";
import type { RingoverCall } from "../../src/server/ringover/schemas";

export const memDb = () => openDb(":memory:");

let cdr = 1;
export function call(
  over: Omit<Partial<RingoverCall>, "user"> & { start: string; talk?: number; user?: number | null },
): RingoverCall {
  const { start, talk = 0, user = 1, ...rest } = over;
  const answered = rest.is_answered ?? talk > 0;
  const startMs = Date.parse(start);
  return {
    cdr_id: cdr++,
    call_id: `c${cdr}`,
    type: "PHONE",
    direction: "out",
    is_answered: answered,
    last_state: answered ? "ANSWERED" : "CANCELLED",
    start_time: start,
    answered_time: answered ? new Date(startMs + 5000).toISOString() : null,
    end_time: new Date(startMs + (talk + 5) * 1000).toISOString(),
    incall_duration: answered ? talk : null,
    total_duration: talk + 5,
    ringing_duration: 5,
    hold_duration: 0,
    queue_duration: 0,
    hangup_by: "CALLER",
    contact_number: "34600000001",
    from_number: "34910000000",
    to_number: "34600000001",
    record: null,
    tags: null,
    contact: null,
    user:
      user === null
        ? null
        : {
            user_id: user,
            firstname: `Nombre${user}`,
            lastname: "Apellido",
            concat_name: `Nombre${user} Apellido`,
            email: `u${user}@test`,
            initial: "NA",
            color: null,
            picture: null,
          },
    ...rest,
  } as RingoverCall;
}
