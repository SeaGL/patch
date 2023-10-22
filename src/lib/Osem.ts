import Bottleneck from "bottleneck";
import { DateTime } from "luxon";
import { env, fetch as unlimited } from "./utilities.js";

const endpoint = "https://osem.seagl.org/api/v1";
const minTime = 1000 / Number(env("OSEM_RATE_LIMIT"));

export interface Event {
  beginning: DateTime;
  end: DateTime;
  id: string;
  room: string;
  title: string;
  url: string;
}

// As at https://github.com/SeaGL/osem/blob/4a8d10b/app/serializers/event_serializer.rb
interface EventsResponse {
  events: {
    length: number;
    room: string;
    scheduled_date: string | null;
    title: string;
    url: string;
  }[];
}

export interface Room {
  name: string;
}

// As at https://github.com/SeaGL/osem/blob/4a8d10b/app/serializers/room_serializer.rb
interface RoomsResponse {
  rooms: {
    guid: string;
    name: string;
  }[];
}

const limiter = new Bottleneck({ maxConcurrent: 1, minTime });
const fetch = limiter.wrap(unlimited);

export const getEvents = async (conference: string): Promise<Event[]> => {
  const url = `${endpoint}/conferences/${encodeURIComponent(conference)}/events`;
  const { events } = (await (await fetch(url)).json()) as EventsResponse;

  return events.flatMap(({ length: minutes, scheduled_date, room, title, url }) => {
    if (!scheduled_date) return [];

    const beginning = DateTime.fromISO(scheduled_date);
    const id = url.match(/\/proposals\/(\d+)/)![1]!;

    return [{ beginning, end: beginning.plus({ minutes }), id, room, title, url }];
  });
};

export const getRooms = async (conference: string): Promise<Record<string, Room>> => {
  const url = `${endpoint}/conferences/${encodeURIComponent(conference)}/rooms`;
  const { rooms } = (await (await fetch(url)).json()) as RoomsResponse;

  return Object.fromEntries(rooms.map(({ guid, name }) => [guid, { name }]));
};
