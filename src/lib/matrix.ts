import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import type {
  MatrixError,
  RoomCreateOptions as RoomCreateFullOptions,
} from "matrix-bot-sdk";

const defaultState: Record<string, StateEvent["content"]> = {
  "m.room.guest_access/": { guest_access: "forbidden" },
};

export interface RoomCreateOptions extends RoomCreateFullOptions {
  preset?: Exclude<NonNullable<RoomCreateFullOptions["preset"]>, "trusted_private_chat">;
}

export type StateEvent = NonNullable<RoomCreateOptions["initial_state"]>[0];

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

export const orNone = (error: MatrixError) => {
  if (error.errcode === "M_NOT_FOUND") return undefined;

  throw error;
};

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
