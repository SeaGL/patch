import Bottleneck from "bottleneck";
import { DateTime } from "luxon";
import { env, fetch as unlimited } from "./utilities.js";

const origin = "https://pretalx.seagl.org";
const minTime = 1000 / Number(env("PRETALX_RATE_LIMIT"));

const limiter = new Bottleneck({ maxConcurrent: 1, minTime });
const fetch = limiter.wrap(unlimited);

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

// Reference: https://docs.pretalx.org/api/resources/#tag/submissions
type TalksResponse = PaginatedResponse<{
  code: string;
  slots: Array<{
    start: string;
    end: string;
    room: { name: { en: string }, id: number };
  }>;
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

  const url = `${origin}/api/events/${event}/submissions/?state=confirmed&expand=slots,slots.room`;
  for await (const page of pages<TalksResponse>(url))
    for (const { code, slots, state, title } of page) {
      // TODO: handle there being more than one slot
      const slot = slots[0];
      talks.push({
        id: code,
        title,
        url: `${origin}/${event}/talk/${code}/`,
        ...(slot
          ? {
              scheduled: {
                beginning: DateTime.fromISO(slot.start),
                end: DateTime.fromISO(slot.end),
                roomId: slot.room.id.toString(),
                roomName: slot.room.name.en,
              },
            }
          : {}),
      });
    }

  return talks;
};

async function* pages<Response extends PaginatedResponse>(
  url: string,
): AsyncGenerator<Response["results"]> {
  let next: string | null = url;
  do {
    const response = (await (await fetch(next)).json()) as Response;
    next = response.next;
    yield response.results;
  } while (next);
}
