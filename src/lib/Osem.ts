import Bottleneck from "bottleneck";
import { DateTime } from "luxon";
import unlimited from "node-fetch"; // Pending DefinitelyTyped/DefinitelyTyped#60924
import { env } from "./utilities.js";

const endpoint = "https://osem.seagl.org/api/v1";
const minTime = 1000 / Number(env("OSEM_RATE_LIMIT"));

// As at https://github.com/SeaGL/osem/blob/0068451/app/serializers/event_serializer.rb
interface EventsResponse {
  events: {
    guid: string;
    length: number;
    scheduled_date: string | null;
    title: string;
  }[];
}

export interface OsemEvent {
  beginning: DateTime;
  end: DateTime;
  id: string;
  title: string;
}

const limiter = new Bottleneck({ maxConcurrent: 1, minTime });
const fetch = limiter.wrap(unlimited);

export const getOsemEvents = async (conference: string): Promise<OsemEvent[]> => {
  const url = `${endpoint}/conferences/${encodeURIComponent(conference)}/events`;
  const { events } = (await (await fetch(url)).json()) as EventsResponse;

  return events.flatMap(({ guid: id, length: minutes, scheduled_date, title }) => {
    if (!scheduled_date) return [];

    const beginning = DateTime.fromISO(scheduled_date);

    return [{ beginning, end: beginning.plus({ minutes }), id, title }];
  });
};
