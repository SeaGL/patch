import { load } from "js-yaml";
import type { PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";
import { assertEquals } from "typia";

type RoomVersion = "12";

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
    roomVersion?: RoomVersion;
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
  defaultRoomVersion: RoomVersion;
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
  return assertEquals<Plan>(load(yaml));
};
