import { DateTime } from "luxon";
import fetch from "node-fetch"; // Pending DefinitelyTyped/DefinitelyTyped#60924

const endpoint = "https://osem.seagl.org/api/v1";

// As at https://github.com/SeaGL/osem/blob/0068451/app/serializers/event_serializer.rb
interface EventsResponse {
  events: {
    guid: string;
    length: number;
    scheduled_date: string | null;
    title: string;
  }[];
}

export interface Session {
  beginning: DateTime;
  end: DateTime;
  id: string;
  title: string;
}

export const getSessions = async (conference: string): Promise<Session[]> => {
  const url = `${endpoint}/conferences/${encodeURIComponent(conference)}/events`;
  const { events } = (await (await fetch(url)).json()) as EventsResponse;

  return events.flatMap(({ guid: id, length: minutes, scheduled_date, title }) => {
    if (!scheduled_date) return [];

    const beginning = DateTime.fromISO(scheduled_date);

    return [{ beginning, end: beginning.plus({ minutes }), id, title }];
  });
};
