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
  beginning: DateTime;
  end: DateTime;
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  url: string;
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
  title: string;
}>;

export const getTalks = async (event: string): Promise<Talk[]> => {
  const talks: Talk[] = [];

  const url = `${origin}/api/events/${event}/talks/?limit=100&state=confirmed`;
  for await (const page of pages<TalksResponse>(url))
    for (const { code, slot, title } of page)
      if (slot)
        talks.push({
          beginning: DateTime.fromISO(slot.start),
          end: DateTime.fromISO(slot.end),
          id: code,
          roomId: slot.room_id.toString(),
          roomName: slot.room.en,
          title,
          url: `${origin}/${event}/talk/${code}/`,
        });

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
