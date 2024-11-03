import { load } from "js-yaml";
import type { PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";
import { assertEquals } from "typia";

export type SessionGroupId =
  | "CURRENT_SESSIONS"
  | "FUTURE_SESSIONS"
  | "PAST_SESSIONS"
  | "UNSCHEDULED_SESSIONS";

export namespace Plan {
  export interface AliasProxy {
    homeserver: string;
    prefix: string;
  }

  export type InheritUserPowerLevels = Record<string, { raiseTo?: number }>;

  export interface Room {
    avatar?: string;
    children?: SessionGroupId | Child[];
    control?: boolean;
    destroy?: boolean;
    intro?: string;
    inviteAttendants?: boolean;
    local: string;
    moderatorsOnly?: boolean;
    name: string;
    private?: boolean;
    readOnly?: boolean;
    redirect?: string;
    suggested?: boolean;
    tag?: string;
    topic?: string;
    widget?: Widget;
  }

  export type Child = Room;

  export interface Sessions {
    demo?: string;
    event: string;
    ignore?: string[];
    intro?: string;
    openEarly: number;
    prefix: string;
    redirects?: Record<string, string>;
    suffixes?: Record<string, string>;
    topic?: string;
    widgets?: Record<string, Widget[]>;
  }

  type Widget = { avatar?: string; name?: string } & (
    | { custom: string }
    | { jitsi: { id: string; name: string } }
  );
}

export type Plan = {
  aliasProxy?: Plan.AliasProxy;
  avatars: Record<string, string>;
  defaultRoomVersion: string;
  homeserver: string;
  inheritUserPowerLevels?: Plan.InheritUserPowerLevels;
  jitsiDomain: string;
  powerLevels: PowerLevels;
  roomAttendants?: Record<string, string>;
  rooms?: Plan.Child[];
  sessions?: Plan.Sessions;
  steward: { avatar?: string; id: string; name: string };
  timeZone: string;
};

export const parsePlan = (yaml: string): Plan => {
  const plan = assertEquals<Plan>(load(yaml));

  const { users } = plan.powerLevels;
  if (!(users?.["steward"] === 100)) throw new Error("Insufficient steward power level");
  delete Object.assign(users, { [plan.steward.id]: users["steward"] })["steward"];

  return plan;
};
