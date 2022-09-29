import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import type {
  MatrixProfileInfo,
  PowerLevelsEventContent as PowerLevels,
  Space,
  SpaceChildEntityOptions as ChildOptions,
  SpaceEntityMap as Children,
} from "matrix-bot-sdk";
import { assert, Equals } from "tsafe";
import type Client from "./Client";
import {
  mergeWithMatrixState,
  orNone,
  resolvePreset,
  RoomCreateOptions,
  StateEvent,
} from "./matrix.js";
import type { Plan, RoomPlan, RoomsPlan } from "./Plan.js";
import { expect, info } from "./utilities.js";

interface Room extends RoomPlan {
  id: string;
}

const listSpace = (space: Space): Promise<Children> => {
  info("🏘️ List space: %j", { id: space.roomId });
  return space.getChildEntities();
};

export default class Reconciler {
  public constructor(private readonly matrix: Client, private readonly plan: Plan) {}

  public async reconcile() {
    info("🔃 Starting reconciliation");
    await this.reconcileProfile(this.plan.steward);
    await this.reconcileRooms(this.plan.rooms);
    info("🔃 Finished reconciliation");
  }

  private async addToSpace(space: Space, child: string, options?: ChildOptions) {
    info("🏘️ Add to space: %j", { space: space.roomId, child });
    await space.addChildRoom(child, { via: [this.plan.homeserver], ...options });
  }

  private getAccessOptions({
    isPrivate,
    isSpace,
    privateParent,
  }: {
    isPrivate: boolean;
    isSpace: boolean;
    privateParent: string | undefined;
  }): Pick<RoomCreateOptions, "initial_state" | "preset"> {
    return {
      preset: isPrivate || privateParent ? "private_chat" : "public_chat",
      initial_state:
        isPrivate || privateParent
          ? [
              {
                type: "m.room.join_rules",
                content: isPrivate
                  ? { type: "m.room.join_rules", content: { join_rule: "knock" } }
                  : {
                      join_rule: "knock_restricted",
                      allow: [{ type: "m.room_membership", room_id: privateParent }],
                    },
              },
            ]
          : isSpace
          ? [
              {
                type: "m.room.history_visibility",
                content: { history_visibility: "world_readable" },
              },
            ]
          : [],
    };
  }

  private async reconcileAvatar(room: string, expected: Room["avatar"]) {
    await this.reconcileState(room, {
      type: "m.room.avatar",
      content: { url: this.resolveAvatar(expected) },
    });
  }

  private async reconcileChildren(space: Space, expected: Room[]) {
    const actual = await listSpace(space);

    for (const id of Object.keys(actual)) {
      if (!expected.some((r) => r.id === id)) await this.removeFromSpace(space, id);
    }

    for (const { id, suggested = false } of expected) {
      const child = actual[id];

      if (child) {
        if (child.suggested !== suggested) {
          info("🏘️ Set suggested: %j", { space: space.roomId, child: id, suggested });
          await space.addChildRoom(id, { ...child.content, suggested });
        }
      } else {
        await this.addToSpace(space, id, { suggested });
      }
    }
  }

  private async reconcileExistence(
    local: string,
    expected: RoomPlan,
    privateParent?: string
  ): Promise<[string | undefined, boolean]> {
    const alias = `#${local}:${this.plan.homeserver}`;

    info("🏷️ Resolve alias: %j", { alias });
    const existing = (await this.matrix.lookupRoomAlias(alias).catch(orNone))?.roomId;

    if (expected.destroy) {
      if (existing) {
        info("🏷️ Delete alias: %j", { alias });
        await this.matrix.deleteRoomAlias(alias);

        const reason = "Decommissioning room";
        const members = await this.matrix.getJoinedRoomMembers(existing);
        for (const user of members) {
          if (user === this.plan.steward.id) continue;

          info("🚪 Kick user: %j", { room: existing, user, reason });
          await this.matrix.kickUser(user, existing, reason);
        }

        info("🚪 Leave room: %j", { room: existing });
        await this.matrix.leaveRoom(existing);

        info("📇 Forget room: %j", { room: existing });
        await this.matrix.forgetRoom(existing);
      }

      return [undefined, false];
    } else {
      if (existing) return [existing, false];

      info("🏠 Create room: %j", { alias });
      const isPrivate = Boolean(expected.private);
      const isSpace = Boolean(expected.children);
      const avatar = this.resolveAvatar(expected.avatar);
      const created = await this.matrix.createRoom(
        mergeWithMatrixState<RoomCreateOptions, Partial<RoomCreateOptions>>(
          {
            room_version: this.plan.defaultRoomVersion,
            room_alias_name: local,
            name: expected.name,
            power_level_content_override: this.plan.powerLevels,
            initial_state: [
              { type: "m.room.avatar", content: { url: avatar } },
              { type: "m.room.canonical_alias", content: { alias } },
            ],
            ...(expected.topic ? { topic: expected.topic } : {}),
            ...(isSpace ? { creation_content: { type: "m.space" } } : {}),
          },
          this.getAccessOptions({ isPrivate, isSpace, privateParent })
        )
      );
      return [created, true];
    }
  }

  private async reconcileName(room: string, expected: string) {
    await this.reconcileState(room, {
      type: "m.room.name",
      content: { name: expected },
    });
  }

  private async reconcilePowerLevels(room: string, expected: PowerLevels) {
    info("🛡️ Get power levels: %j", { room });
    const actual: PowerLevels = await this.matrix.getRoomStateEvent(
      room,
      "m.room.power_levels",
      ""
    );
    let changed = false;

    mergeWith(actual, expected, (from, to, ability) => {
      if (typeof to === "object" || from === to) return;

      info("🛡️ Update power level: %j", { room, ability, from, to });
      changed = true;
    });

    if (changed) {
      info("🛡️ Set power levels: %j", { room, content: actual });
      await this.matrix.sendStateEvent(room, "m.room.power_levels", "", actual);
    }
  }

  private async reconcilePrivacy(
    room: string,
    isPrivate: boolean,
    isSpace: boolean,
    privateParent: string | undefined
  ) {
    type ImplementedFor = "initial_state" | "preset";

    const options = this.getAccessOptions({ isPrivate, isSpace, privateParent });
    const expected = mergeWithMatrixState(resolvePreset(options.preset), options);
    assert<Equals<typeof expected, Pick<RoomCreateOptions, ImplementedFor>>>();

    if (expected.initial_state)
      for (const event of expected.initial_state) await this.reconcileState(room, event);
  }

  private async reconcileProfile({ avatar, name }: Plan["steward"]) {
    const user = this.plan.steward.id;

    info("👤 Get profile: %j", { user });
    const actual: MatrixProfileInfo = await this.matrix.getUserProfile(user);

    if (!(actual.displayname === name)) {
      info("👤 Set display name: %j", { user, from: actual.displayname, to: name });
      await this.matrix.setDisplayName(name);
    }

    const url = this.resolveAvatar(avatar);
    if (!(actual.avatar_url === url)) {
      info("👤 Set avatar: %j", { user, from: actual.avatar_url, to: url });
      await this.matrix.setAvatarUrl(url);
    }
  }

  private async reconcileRoom(
    local: string,
    expected: RoomPlan,
    privateParent?: string
  ): Promise<Room | undefined> {
    const [id, created] = await this.reconcileExistence(local, expected, privateParent);

    if (!id) {
      if (typeof expected.children === "object")
        await this.reconcileRooms(expected.children);

      return undefined;
    }

    if (!created) {
      const isPrivate = Boolean(expected.private);
      const isSpace = Boolean(expected.children);

      await this.reconcilePowerLevels(id, this.plan.powerLevels);
      await this.reconcilePrivacy(id, isPrivate, isSpace, privateParent);
      await this.reconcileAvatar(id, expected.avatar);
      await this.reconcileName(id, expected.name);
      await this.reconcileTopic(id, expected.topic);
    }

    if (expected.children) {
      info("🏘️ Get space: %j", { id });
      const space = await this.matrix.getSpace(id);

      const privateParent = expected.private ? id : undefined;
      const children = await this.reconcileRooms(expected.children, privateParent);

      await this.reconcileChildren(space, children);
    }

    return { ...expected, id };
  }

  private async reconcileRooms(
    expected: RoomsPlan,
    privateParent?: string
  ): Promise<Room[]> {
    const rooms = [];

    for (const [local, plan] of Object.entries(expected)) {
      const room = await this.reconcileRoom(local, plan, privateParent);

      if (room) rooms.push(room);
    }

    return rooms;
  }

  private async reconcileState(room: string, expected: StateEvent) {
    const { type, state_key: key, content: to } = expected;
    info("🗄️ Get state: %j", { room, type, key });
    const from = await this.matrix.getRoomStateEvent(room, type, key).catch(orNone);

    if ((from || to) && !isEqual(from, to)) {
      info("🗄️ Set state: %j", { room, type, key, from, to });
      await this.matrix.sendStateEvent(room, type, key ?? "", to);
    }
  }

  private async reconcileTopic(room: string, expected: Room["topic"]) {
    await this.reconcileState(room, {
      type: "m.room.topic",
      content: expected && { topic: expected },
    });
  }

  private async removeFromSpace(space: Space, child: string) {
    info("🏘️ Remove from space: %j", { space: space.roomId, child });
    await space.removeChildRoom(child);
  }

  private resolveAvatar(name: string = "default"): string {
    return expect(this.plan.avatars[name], `avatar ${name}`);
  }
}
