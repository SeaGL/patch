import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import { DateTime } from "luxon";
import type {
  MatrixProfileInfo,
  PowerLevelsEventContent as PowerLevels,
  Space,
  SpaceEntityMap as Children,
} from "matrix-bot-sdk";
import { assert, Equals } from "tsafe";
import type Client from "./Client";
import {
  mergeWithMatrixState,
  orNone,
  resolvePreset,
  RoomCreateOptions,
  StateEventOptions,
} from "./matrix.js";
import { getSessions, Session } from "./Osem.js";
import type { Plan, RoomPlan, RoomsPlan, SessionGroupId, SessionsPlan } from "./Plan.js";
import { expect, logger } from "./utilities.js";

const { debug, info } = logger("Reconciler");

interface Room extends RoomPlan {
  id: string;
  order: string;
}

interface ListedSpace extends Space {
  children: Children;
}

const compareSessions = (a: Session, b: Session): number =>
  a.beginning !== b.beginning
    ? a.beginning.valueOf() - b.beginning.valueOf()
    : a.end !== b.end
    ? a.end.valueOf() - b.end.valueOf()
    : a.title.localeCompare(b.title);
const sortKey = (index: number): string => String(10 * (1 + index)).padStart(4, "0");

export default class Reconciler {
  #sessionGroups: { [id in SessionGroupId]?: ListedSpace };

  public constructor(private readonly matrix: Client, private readonly plan: Plan) {
    this.#sessionGroups = {};
  }

  public async reconcile() {
    info("🔃 Reconcile");
    await this.reconcileProfile(this.plan.steward);
    await this.reconcileRooms(this.plan.rooms);
    await this.reconcileSessions(this.plan.sessions);
    debug("🔃 Completed reconciliation");
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

  private async listSpace(space: Space): Promise<ListedSpace> {
    debug("🏘️ List space", { id: space.roomId });
    return Object.assign(space, { children: await space.getChildEntities() });
  }

  private async reconcileAvatar(room: string, expected: Room["avatar"]) {
    await this.reconcileState(room, {
      type: "m.room.avatar",
      content: { url: this.resolveAvatar(expected) },
    });
  }

  private async reconcileChildhood(space: ListedSpace, room: Room, include = true) {
    const { id, order, suggested = false } = room;
    const actual = space.children[id]?.content;
    if (!include) return actual && (await this.removeFromSpace(space, id));

    const expected = { order, suggested };

    if (actual) {
      let changed = false;
      mergeWith(actual, expected, (from, to, option) => {
        if (typeof to === "object" || !(from || to) || from === to) return;

        info("🏘️ Update childhood", { space: space.roomId, id, option, from, to });
        changed = true;
      });

      if (changed) {
        debug("🏘️ Set childhood", { space: space.roomId, child: id });
        await space.addChildRoom(id, actual);
      }
    } else {
      info("🏘️ Add to space", { space: space.roomId, child: id });
      await space.addChildRoom(id, { via: [this.plan.homeserver], ...expected });
    }
  }

  private async reconcileChildren(space: ListedSpace, expected: Room[]) {
    const actual = Object.keys(space.children);
    const ids = new Set(expected.map((r) => r.id));

    for (const a of actual) if (!ids.has(a)) await this.removeFromSpace(space, a);
    for (const room of expected) await this.reconcileChildhood(space, room);
  }

  private async reconcileExistence(
    local: string,
    expected: RoomPlan,
    privateParent?: string
  ): Promise<[string | undefined, boolean]> {
    const alias = `#${local}:${this.plan.homeserver}`;

    debug("🏷️ Resolve alias", { alias });
    const existing = (await this.matrix.lookupRoomAlias(alias).catch(orNone))?.roomId;

    if (expected.destroy) {
      if (existing) {
        info("🏷️ Delete alias", { alias });
        await this.matrix.deleteRoomAlias(alias);

        const reason = "Decommissioning room";
        const members = await this.matrix.getJoinedRoomMembers(existing);
        for (const user of members) {
          if (user === this.plan.steward.id) continue;

          info("🚪 Kick user", { room: existing, user, reason });
          await this.matrix.kickUser(user, existing, reason);
        }

        info("🚪 Leave room", { room: existing });
        await this.matrix.leaveRoom(existing);

        debug("📇 Forget room", { room: existing });
        await this.matrix.forgetRoom(existing);
      }

      return [undefined, false];
    } else {
      if (existing) return [existing, false];

      info("🏠 Create room", { alias });
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
    debug("🛡️ Get power levels", { room });
    const actual: PowerLevels = await this.matrix.getRoomStateEvent(
      room,
      "m.room.power_levels",
      ""
    );
    let changed = false;

    mergeWith(actual, expected, (from, to, ability) => {
      if (typeof to === "object" || from === to) return;

      info("🛡️ Update power level", { room, ability, from, to });
      changed = true;
    });

    if (changed) {
      debug("🛡️ Set power levels", { room, content: actual });
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

    debug("👤 Get profile", { user });
    const actual: MatrixProfileInfo = await this.matrix.getUserProfile(user);

    if (!(actual.displayname === name)) {
      info("👤 Set display name", { user, from: actual.displayname, to: name });
      await this.matrix.setDisplayName(name);
    }

    const url = this.resolveAvatar(avatar);
    if (!(actual.avatar_url === url)) {
      info("👤 Set avatar", { user, from: actual.avatar_url, to: url });
      await this.matrix.setAvatarUrl(url);
    }
  }

  private async reconcileRoom(
    local: string,
    order: string,
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
      debug("🏘️ Get space", { id });
      const space = await this.matrix.getSpace(id);

      if (typeof expected.children === "string") {
        this.#sessionGroups[expected.children] = await this.listSpace(space);
      } else {
        await this.reconcileChildren(
          await this.listSpace(space),
          await this.reconcileRooms(expected.children, expected.private ? id : undefined)
        );
      }
    }

    return { ...expected, id, order };
  }

  private async reconcileRooms(
    expected: RoomsPlan,
    privateParent?: string
  ): Promise<Room[]> {
    const rooms = [];

    for (const [index, [local, plan]] of Object.entries(expected).entries()) {
      const order = sortKey(index);
      const room = await this.reconcileRoom(local, order, plan, privateParent);

      if (room) rooms.push(room);
    }

    return rooms;
  }

  private async reconcileSessions({ conference, demo }: SessionsPlan) {
    const now = DateTime.local({ zone: this.plan.timeZone });

    debug("📅 Get sessions", { conference });
    const sessions = await getSessions(conference);
    sessions.sort(compareSessions);
    if (demo) {
      const dt = DateTime.fromISO(demo, { zone: this.plan.timeZone });
      const offset = now.startOf("day").diff(dt, "days");
      info("📅 Override conference date", { date: dt.toISODate() });
      for (const session of sessions) {
        const [from, to] = [session.beginning, session.beginning.plus(offset)];
        debug("📅 Override session time", { from: from.toISO(), to: to.toISO() });
        session.beginning = to;
        session.end = session.end.plus(offset);
      }
    }

    for (const [index, session] of sessions.entries()) {
      const local = `${this.plan.sessions.prefix}${session.id}`;
      const order = sortKey(index);
      const name = `${session.beginning.toFormat("EEE HH:mm")} ${session.title}`;
      const room = (await this.reconcileRoom(local, order, { name }))!;

      await this.reconcileSessionGroups(room, session, now);
    }
  }

  private async reconcileSessionGroups(room: Room, session: Session, now: DateTime) {
    const {
      CURRENT_SESSIONS: current,
      FUTURE_SESSIONS: future,
      PAST_SESSIONS: past,
    } = this.#sessionGroups;

    const beginning = session.beginning.minus({ minutes: this.plan.sessions.beginEarly });
    const [began, ended] = [beginning <= now, session.end <= now];
    const [isFuture, isCurrent, isPast] = [!began, began && !ended, ended];

    if (future) await this.reconcileChildhood(future, room, isFuture);
    if (current) await this.reconcileChildhood(current, room, isCurrent);
    if (past) await this.reconcileChildhood(past, room, isPast);
  }

  private async reconcileState(room: string, expected: StateEventOptions) {
    const { type, state_key: key, content: to } = expected;
    debug("🗄️ Get state", { room, type, key });
    const from = await this.matrix.getRoomStateEvent(room, type, key).catch(orNone);

    if ((from || to) && !isEqual(from, to)) {
      info("🗄️ Set state", { room, type, key, from, to });
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
    info("🏘️ Remove from space", { space: space.roomId, child });
    await space.removeChildRoom(child);
  }

  private resolveAvatar(name: string = "default"): string {
    return expect(this.plan.avatars[name], `avatar ${name}`);
  }
}
