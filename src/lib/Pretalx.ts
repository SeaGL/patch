import Bottleneck from "bottleneck";
import { DateTime } from "luxon";
import { env, fetch as unlimited } from "./utilities.js";

const origin = "https://pretalx.seagl.org";
const minTime = 1000 / Number(env("PRETALX_RATE_LIMIT"));

const limiter = new Bottleneck({ maxConcurrent: 1, minTime });
const fetch: typeof unlimited = limiter.wrap(unlimited);

// Reference: https://docs.pretalx.org/api/fundamentals/#pagination
interface PaginatedResponse<T = {}> {
  next: string | null;
  results: T[];
}

export interface Talk {
  id: string;
  title: string;
  url: string;
  scheduled?: {
    beginning: DateTime;
    end: DateTime;
    roomId: string;
    roomName: string;
  };
}

// Reference: https://docs.pretalx.org/api/resources/talks/
type TalksResponse = PaginatedResponse<{
  code: string;
  slot?: {
    end: string;
    room: { en: string };
    room_id: number;
    start: string;
  };
  state:
    | "accepted"
    | "canceled"
    | "confirmed"
    | "deleted"
    | "draft"
    | "rejected"
    | "submitted"
    | "withdrawn";
  title: string;
}>;

export const getTalks = async (event: string): Promise<Talk[]> => {
  const talks: Talk[] = [];

  const url = `${origin}/api/events/${event}/talks/?limit=100`;
  for await (const page of pages<TalksResponse>(url))
    for (const { code, slot, state, title } of page)
      // XXX: if you set PRETALX_API_KEY, it will return unscheduled social events that don't have a slot defined
      talks.push({
        id: code,
        title,
        url: `${origin}/${event}/talk/${code}/`,
        ...(slot && state === "confirmed"
          ? {
              scheduled: {
                beginning: DateTime.fromISO(slot.start),
                end: DateTime.fromISO(slot.end),
                roomId: slot.room_id.toString(),
                roomName: slot.room.en,
              },
            }
          : {}),
      });

  return talks;
};

async function* pages<Response extends PaginatedResponse>(
  url: string,
): AsyncGenerator<Response["results"]> {
  let next: string | null = url;
  do {
    const authHeader = process.env["PRETALX_API_KEY"] ? {
      "Authorization": `Token ${process.env["PRETALX_API_KEY"]}`
    } : {};
    const response = (await (await fetch(next, { headers: authHeader })).json()) as Response;
    next = response.next;
    yield response.results;
  } while (next);
}
