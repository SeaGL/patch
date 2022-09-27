// Pending samchon/typescript-json#153

import { isLeft } from "fp-ts/lib/Either.js";
import t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { load } from "js-yaml";
import type { PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";

const RoomPlan: t.Type<RoomPlan> = t.recursion("RoomPlan", () =>
  t.intersection([
    t.type({ avatar: t.string, name: t.string, topic: t.string }),
    t.partial(
      t.type({
        children: RoomsPlan,
        destroy: t.boolean,
        private: t.boolean,
        suggested: t.boolean,
      }).props
    ),
  ])
);
export interface RoomPlan {
  avatar: string;
  children?: RoomsPlan;
  destroy?: boolean;
  name: string;
  private?: boolean;
  suggested?: boolean;
  topic: string;
}

const RoomsPlan = t.record(t.string, RoomPlan);
export type RoomsPlan = Record<string, RoomPlan>;

const PowerLevels: t.Type<PowerLevels> = t.partial(
  t.type({
    ban: t.number,
    events: t.record(t.string, t.number),
    events_default: t.number,
    historical: t.number,
    invite: t.number,
    kick: t.number,
    redact: t.number,
    state_default: t.number,
    users: t.record(t.string, t.number),
    users_default: t.number,
    notifications: t.partial(t.type({ room: t.number }).props),
  }).props
);

const Plan = t.type({
  avatars: t.record(t.string, t.string),
  defaultRoomVersion: t.string,
  homeserver: t.string,
  powerLevels: PowerLevels,
  rooms: RoomsPlan,
  user: t.string,
});
export type Plan = t.TypeOf<typeof Plan>;

export const parsePlan = (yaml: string): Plan => {
  const result = Plan.decode(load(yaml));

  if (isLeft(result)) {
    throw new Error(PathReporter.report(result).join("\n"));
  } else {
    const plan = result.right;

    if (!(plan.powerLevels.users?.[plan.user] === 100))
      throw new Error("Missing self power level");

    return plan;
  }
};
