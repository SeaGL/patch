// Pending samchon/typescript-json#153, gcanti/io-ts#322

import { isLeft } from "fp-ts/lib/Either.js";
import t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { load } from "js-yaml";
import type { PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";

const RoomPlan: t.Type<RoomPlan> = t.recursion("RoomPlan", () =>
  t.intersection([
    t.strict({ name: t.string, topic: t.string }),
    t.partial({
      avatar: t.string,
      children: RoomsPlan,
      destroy: t.boolean,
      private: t.boolean,
      suggested: t.boolean,
    }),
  ])
);
export interface RoomPlan {
  avatar?: string;
  children?: RoomsPlan;
  destroy?: boolean;
  name: string;
  private?: boolean;
  suggested?: boolean;
  topic: string;
}

const RoomsPlan = t.record(t.string, RoomPlan);
export type RoomsPlan = Record<string, RoomPlan>;

const PowerLevels: t.Type<PowerLevels> = t.partial({
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
  notifications: t.partial({ room: t.number }),
});

const StewardPlan = t.intersection([
  t.strict({ id: t.string, name: t.string }),
  t.partial({ avatar: t.string }),
]);
export type StewardPlan = t.TypeOf<typeof StewardPlan>;

const Plan = t.strict({
  avatars: t.record(t.string, t.string),
  defaultRoomVersion: t.string,
  homeserver: t.string,
  powerLevels: PowerLevels,
  rooms: RoomsPlan,
  steward: StewardPlan,
});
export type Plan = t.TypeOf<typeof Plan>;

export const parsePlan = (yaml: string): Plan => {
  const result = Plan.decode(load(yaml));
  if (isLeft(result)) throw new Error(PathReporter.report(result).join("\n"));
  const plan = result.right;

  const { users } = plan.powerLevels;
  if (!(users?.["steward"] === 100)) throw new Error("Insufficient steward power level");
  delete Object.assign(users, { [plan.steward.id]: users["steward"] })["steward"];

  return plan;
};
