import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import type { MatrixError, PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";
import type { RoomCreateOptions } from "./Client.js";
import type { IntroEvent, RedirectEvent, TagEvent } from "./Reconciler";

//
// Events
//

interface IEvent<T extends string, C> {
  type: T;
  event_id: string;
  sender: string;
  content: C;
}

export interface IStateEvent<T extends string, C> extends IEvent<T, C> {
  state_key: string;
}

type WidgetContent = {
  creatorUserId: string;
  name: string;
  avatar_url?: string;
} & (
  | { type: "customwidget"; url: string }
  | {
      type: "jitsi";
      url: string;
      data: { domain: string; conferenceId: string; roomName: string };
    }
);

export type StateEvent<T = unknown> = (
  | IStateEvent<"im.vector.modular.widgets", {} | WidgetContent>
  | IStateEvent<
      "io.element.widgets.layout",
      {
        widgets: Record<
          string,
          { index: number; container: "top"; height: number; width: number }
        >;
      }
    >
  | IStateEvent<"m.room.avatar", { url: string }>
  | IStateEvent<"m.room.canonical_alias", { alias: string; alt_aliases?: string[] }>
  | IStateEvent<"m.room.guest_access", { guest_access: "can_join" | "forbidden" }>
  | IStateEvent<
      "m.room.history_visibility",
      { history_visibility: "invited" | "joined" | "shared" | "world_readable" }
    >
  | IStateEvent<
      "m.room.join_rules",
      | { join_rule: "invite" | "knock" | "private" | "public" }
      | {
          join_rule: "knock_restricted" | "restricted";
          allow: { type: "m.room_membership"; room_id: string }[];
        }
    >
  | IStateEvent<
      "m.room.member",
      { membership: "ban" | "invite" | "join" | "knock" | "leave" }
    >
  | IStateEvent<"m.room.name", { name: string }>
  | IStateEvent<"m.room.power_levels", PowerLevels>
  | IStateEvent<"m.room.topic", { topic: string }>
  | IntroEvent
  | RedirectEvent
  | TagEvent
) & { type: T };

export type Event<T = unknown> =
  | StateEvent<T>
  | IEvent<
      "m.room.message",
      { body: string; "m.relates_to"?: { rel_type: "m.replace"; event_id: string } } & ({
        msgtype: "m.notice" | "m.text";
      } & ({} | { format: "org.matrix.custom.html"; formatted_body: string }))
    >;

export type StateEventInput = Omit<StateEvent, "event_id" | "sender" | "state_key"> &
  Partial<Pick<StateEvent, "state_key">>;

export const mergeMatrixState = (...stores: StateEvent[][]): StateEvent[] => {
  const events = new Map<string, StateEvent>();
  const insert = (event: StateEvent) => {
    const key = `${event.type}/${event.state_key ?? ""}`;

    if (!events.has(key) && isEqual(defaultState[key], event.content)) return;

    events.set(key, event);
  };

  stores.forEach((s) => s.forEach(insert));

  return [...events.values()];
};

export const mergeWithMatrixState = <T, F>(to: T, from: F): T & F =>
  mergeWith(to, from, (a, b) =>
    Array.isArray(a) && !(a[0] && !(a[0].type && a[0].content))
      ? mergeMatrixState(a, b)
      : undefined
  );

//
// Client API
//

export interface Sync {
  rooms?: {
    join?: {
      [id: string]: {
        state: { events: StateEvent[] };
        timeline: { events: Event[] };
      };
    };
  };
}

// Workaround for turt2live/matrix-bot-sdk#197
export const orNone = (error: MatrixError) => {
  if (error.errcode === "M_NOT_FOUND") return undefined;

  throw error;
};

//
// Server constants
//

const defaultState: Record<string, StateEvent["content"]> = {
  "m.room.guest_access/": { guest_access: "forbidden" },
};

export const moderatorLevel = 50;

// As at https://github.com/matrix-org/synapse/blob/v1.67.0/synapse/handlers/room.py#L123
export const resolvePreset = (
  preset: RoomCreateOptions["preset"]
): Pick<RoomCreateOptions, "initial_state"> => {
  switch (preset) {
    case undefined:
      return {};
    case "public_chat":
      return {
        initial_state: [
          { type: "m.room.guest_access", content: { guest_access: "forbidden" } },
          {
            type: "m.room.history_visibility",
            content: { history_visibility: "shared" },
          },
          { type: "m.room.join_rules", content: { join_rule: "public" } },
        ],
      };
    case "private_chat":
      return {
        initial_state: [
          { type: "m.room.guest_access", content: { guest_access: "can_join" } },
          {
            type: "m.room.history_visibility",
            content: { history_visibility: "shared" },
          },
          { type: "m.room.join_rules", content: { join_rule: "invite" } },
        ],
      };
    default:
      throw new Error(`Not implemented for preset ${preset}`);
  }
};

//
// Helpers
//

export const isUserId = (text: string): boolean => /^@[-.\w]+:[-.\w]+$/.test(text);

export const permalinkPattern = /https:\/\/matrix\.to\/#\/(@[-.\w]+:[-.\w]+)/;
