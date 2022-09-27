import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import type { PowerLevelsEventContent as PowerLevels } from "matrix-bot-sdk";
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

export default class Reconciler {
  public constructor(
    private readonly matrix: Client,
    private readonly userId: string,
    private readonly plan: Plan
  ) {
    this.validatePlan();
  }

  public async reconcile() {
    info("🔃 Starting reconciliation");
    await this.reconcileRooms(this.plan.rooms);
    info("🔃 Finished reconciliation");
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

  private async reconcileAvatar(room: string, expected: string) {
    await this.reconcileState(room, {
      type: "m.room.avatar",
      content: { url: this.resolveAvatar(expected) },
    });
  }

  private async reconcileChildren(parent: string, expected: Room[]) {
    info("🏘️ Get space: %j", { space: parent });
    const space = await this.matrix.getSpace(parent);
    const actual = await space.getChildEntities();

    for (const id of Object.keys(actual)) {
      if (!expected.some((r) => r.id === id)) {
        info("🏘️ Remove from space: %j", { space: space.roomId, child: id });
        await space.removeChildRoom(id);
      }
    }

    for (const { id, suggested = false } of expected) {
      const child = actual[id];

      if (child) {
        if (child.suggested !== suggested) {
          info("🏘️ Set suggested: %j", { space: space.roomId, child: id, suggested });
          await space.addChildRoom(id, { ...child.content, suggested });
        }
      } else {
        info("🏘️ Add to space: %j", { space: space.roomId, child: id });
        await space.addChildRoom(id, { suggested, via: [this.plan.homeserver] });
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
          if (user === this.userId) continue;

          info("👤 Kick user: %j", { room: existing, user, reason });
          await this.matrix.kickUser(user, existing, reason);
        }

        info("👤 Leave room: %j", { room: existing });
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
            topic: expected.topic,
            power_level_content_override: this.plan.powerLevels,
            initial_state: [
              { type: "m.room.avatar", content: { url: avatar } },
              { type: "m.room.canonical_alias", content: { alias } },
            ],
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

  private async reconcileRoom(
    local: string,
    expected: RoomPlan,
    privateParent?: string
  ): Promise<Room | undefined> {
    const [id, created] = await this.reconcileExistence(local, expected, privateParent);

    if (id && !created) {
      const isPrivate = Boolean(expected.private);
      const isSpace = Boolean(expected.children);

      await this.reconcilePowerLevels(id, this.plan.powerLevels);
      await this.reconcilePrivacy(id, isPrivate, isSpace, privateParent);
      await this.reconcileAvatar(id, expected.avatar);
      await this.reconcileName(id, expected.name);
      await this.reconcileTopic(id, expected.topic);
    }

    if (expected.children) {
      const privateParent = expected.private ? id : undefined;
      const children = await this.reconcileRooms(expected.children, privateParent);

      if (id) await this.reconcileChildren(id, children);
    }

    return id ? { ...expected, id } : undefined;
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

    if (!isEqual(from, to)) {
      info("🗄️ Set state: %j", { room, type, key, from, to });
      await this.matrix.sendStateEvent(room, type, key ?? "", to);
    }
  }

  private async reconcileTopic(room: string, expected: string) {
    await this.reconcileState(room, {
      type: "m.room.topic",
      content: { topic: expected },
    });
  }

  private resolveAvatar(name: string): string {
    return expect(this.plan.avatars[name], `avatar ${name}`);
  }

  private validatePlan() {
    if (!(this.plan.powerLevels.users?.[this.userId] === 100))
      throw new Error("Missing self power level");
  }
}
