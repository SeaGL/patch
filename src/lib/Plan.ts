import { load } from "js-yaml";
import type { PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";
import { assertEquals } from "typescript-json";
import type { WidgetContent } from "./matrix";

export type SessionGroupId = "CURRENT_SESSIONS" | "FUTURE_SESSIONS" | "PAST_SESSIONS";

export interface RoomPlan {
  avatar?: string;
  children?: RoomsPlan | SessionGroupId;
  destroy?: boolean;
  name: string;
  private?: boolean;
  readOnly?: boolean;
  redirect?: string;
  suggested?: boolean;
  tag?: string;
  topic?: string;
  widget?: WidgetPlan;
}

export type RoomsPlan = Record<string, RoomPlan>;

export interface SessionsPlan {
  conference: string;
  demo?: string;
  ignore?: string[];
  openEarly: number;
  prefix: string;
  redirects?: Record<string, string>;
  suffixes?: Record<string, string>;
  widgets?: Record<string, { [day: number]: WidgetPlan }>;
}

export type Plan = {
  avatars: Record<string, string>;
  defaultRoomVersion: string;
  homeserver: string;
  powerLevels: PowerLevels;
  rooms: RoomsPlan;
  sessions: SessionsPlan;
  steward: {
    avatar?: string;
    id: string;
    name: string;
  };
  timeZone: string;
};

export type WidgetPlan = Omit<WidgetContent, "avatar_url" | "creatorUserId" | "name"> & {
  avatar?: string;
  name?: WidgetContent["name"];
};

export const parsePlan = (yaml: string): Plan => {
  const plan = assertEquals<Plan>(load(yaml));

  const { users } = plan.powerLevels;
  if (!(users?.["steward"] === 100)) throw new Error("Insufficient steward power level");
  delete Object.assign(users, { [plan.steward.id]: users["steward"] })["steward"];

  return plan;
};
