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
    roomVersion?: string;
    suggested?: boolean;
    tag?: string;
    topic?: string;
    widget?: Widget;
  }

  export type Child = Room | string;

  export interface Sessions {
    customIntro?: Record<string, string>;
    customName?: Record<string, string>;
    customTopic?: Record<string, string>;
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

const supportedRoomVersions = ["12"];

const checkRoomVersion = (rooms: SessionGroupId | Plan.Child[]) => {
  for (let room of rooms) {
    if (typeof room === "string") return;

    if (room.roomVersion && !supportedRoomVersions.includes(room.roomVersion)) {
      throw new Error("Unsupported room version " + room.roomVersion);
    }

    if (room.children) checkRoomVersion(room.children);
  }
};

export const parsePlan = (yaml: string): Plan => {
  const plan = assertEquals<Plan>(load(yaml));

  if (!supportedRoomVersions.includes(plan.defaultRoomVersion)) throw new Error("Unsupported default room version " + plan.defaultRoomVersion);
  if (plan.rooms) checkRoomVersion(plan.rooms);

  return plan;
};
