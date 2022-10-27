import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import { DateTime, Duration } from "luxon";
import type {
  MatrixProfileInfo,
  PowerLevelsEventContent as PowerLevels,
  Space,
  SpaceEntityMap as Children,
} from "matrix-bot-sdk";
import { assert, Equals } from "tsafe";
import type Client from "./Client.js";
import type { RoomCreateOptions } from "./Client.js";
import {
  mergeWithMatrixState,
  orNone,
  resolvePreset,
  StateEvent,
  StateEventInput,
} from "./matrix.js";
import { getOsemEvents, OsemEvent } from "./Osem.js";
import type { Plan, RoomPlan, RoomsPlan, SessionGroupId, SessionsPlan } from "./Plan.js";
import type { Scheduled } from "./scheduling.js";
import { expect, logger, maxDelay } from "./utilities.js";

const { debug, info } = logger("Reconciler");

interface Room extends RoomPlan {
  id: string;
  local: string;
  order: string;
}

interface ListedSpace extends Space {
  children: Children;
  local: string;
}

interface Session extends OsemEvent {
  open: DateTime;
}

const reconcilePeriod = Duration.fromObject({ hours: 1 });

const compareSessions = (a: Session, b: Session): number =>
  a.beginning !== b.beginning
    ? a.beginning.valueOf() - b.beginning.valueOf()
    : a.end !== b.end
    ? a.end.valueOf() - b.end.valueOf()
    : a.title.localeCompare(b.title);
const sortKey = (index: number): string => String(10 * (1 + index)).padStart(4, "0");

export default class Reconciler {
  #scheduledReconcile: Scheduled | undefined;
  #scheduledRegroups: Map<Room["id"], Scheduled>;
  #sessionGroups: { [id in SessionGroupId]?: ListedSpace };
  #spaceByChild: Map<string, string>;

  public constructor(private readonly matrix: Client, private readonly plan: Plan) {
    this.#scheduledRegroups = new Map();
    this.#sessionGroups = {};
    this.#spaceByChild = new Map();
  }

  public getParent(child: string): string | undefined {
    return this.#spaceByChild.get(child);
  }

  public async start() {
    await this.reconcile();
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
      initial_state: isPrivate
        ? [{ type: "m.room.join_rules", content: { join_rule: "knock" } }]
        : privateParent
        ? [
            {
              type: "m.room.join_rules",
              content: {
                join_rule: "restricted" /* knock_restricted pending room version 10 */,
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

  private async listSpace(space: Space, local: string): Promise<ListedSpace> {
    debug("🏘️ List space", { local });
    return Object.assign(space, { children: await space.getChildEntities(), local });
  }

  private async reconcileAvatar(room: Room) {
    const content = { url: this.resolveAvatar(room.avatar) };
    await this.reconcileState(room, { type: "m.room.avatar", content });
  }

  private async reconcile(now = DateTime.local({ zone: this.plan.timeZone })) {
    this.scheduleReconcile(now.plus(reconcilePeriod));

    info("🔃 Reconcile");
    await this.reconcileProfile(this.plan.steward);
    await this.reconcileRooms(this.plan.rooms);
    await this.reconcileSessions(this.plan.sessions, now);
    debug("🔃 Completed reconciliation");
  }

  private async reconcileChildhood(space: ListedSpace, room: Room, include = true) {
    const { id, local: child, order, suggested = false } = room;
    const actual = space.children[id]?.content;
    if (!include) return actual && (await this.removeFromSpace(space, id, child));

    const expected = { order, suggested };

    if (actual) {
      let changed = false;
      mergeWith(actual, expected, (from, to, option) => {
        if (typeof to === "object" || !(from || to) || from === to) return;

        info("🏘️ Update childhood", { space: space.local, child, option, from, to });
        changed = true;
      });

      if (changed) {
        debug("🏘️ Set childhood", { space: space.local, child });
        await space.addChildRoom(id, actual);
      }
    } else {
      info("🏘️ Add to space", { space: space.local, child });
      await space.addChildRoom(id, { via: [this.plan.homeserver], ...expected });
    }
    this.#spaceByChild.set(id, space.roomId);
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

      info("🏠 Create room", { local });
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

  private async reconcileName(room: Room) {
    const content = { name: room.name };
    await this.reconcileState(room, { type: "m.room.name", content });
  }

  private async reconcilePowerLevels({ id, local: room }: Room, expected: PowerLevels) {
    debug("🛡️ Get power levels", { room });
    const actual = expect(
      await this.matrix.getRoomStateEvent<StateEvent<"m.room.power_levels">>(
        id,
        "m.room.power_levels"
      ),
      "power levels"
    );
    let changed = false;

    mergeWith(actual, expected, (from, to, ability) => {
      if (typeof to === "object" || from === to) return;

      info("🛡️ Update power level", { room, ability, from, to });
      changed = true;
    });

    if (changed) {
      debug("🛡️ Set power levels", { room, content: actual });
      await this.matrix.sendStateEvent(id, "m.room.power_levels", "", actual);
    }
  }

  private async reconcilePrivacy(room: Room, privateParent: string | undefined) {
    type ImplementedFor = "initial_state" | "preset";

    const isPrivate = Boolean(room.private);
    const isSpace = Boolean(room.children);
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

    const room = { ...expected, id, local, order };

    if (!created) {
      await this.reconcilePowerLevels(room, this.plan.powerLevels);
      await this.reconcilePrivacy(room, privateParent);
      await this.reconcileAvatar(room);
      await this.reconcileName(room);
      await this.reconcileTopic(room);
    }

    if (expected.children) {
      debug("🏘️ Get space", { local });
      const space = await this.matrix.getSpace(id);

      if (typeof expected.children === "string") {
        this.#sessionGroups[expected.children] = await this.listSpace(space, local);
      } else {
        await this.reconcileChildren(
          await this.listSpace(space, local),
          await this.reconcileRooms(expected.children, expected.private ? id : undefined)
        );
      }
    }

    return room;
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

  private async reconcileSessions({ conference, demo }: SessionsPlan, now: DateTime) {
    debug("📅 Get sessions", { conference });
    const sessions = (await getOsemEvents(conference)).map((event) => ({
      ...event,
      open: event.beginning.minus({ minutes: this.plan.sessions.openEarly }),
    }));
    sessions.sort(compareSessions);
    if (demo) {
      const dt = DateTime.fromISO(demo, { zone: this.plan.timeZone });
      const offset = now.startOf("day").diff(dt, "days");
      info("📅 Override conference date", { from: dt.toISODate(), to: now.toISODate() });
      for (const session of sessions) {
        const to = session.beginning.plus(offset);
        debug("📅 Override session time", {
          id: session.id,
          from: session.beginning.toISO(),
          to: to.toISO(),
        });
        session.open = session.open.plus(offset);
        session.beginning = to;
        session.end = session.end.plus(offset);
      }
    }

    for (const [index, session] of sessions.entries()) {
      const local = `${this.plan.sessions.prefix}${session.guid}`;
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

    const [opened, ended] = [session.open <= now, session.end <= now];
    const [isFuture, isCurrent, isPast] = [!opened, opened && !ended, ended];

    if (future) await this.reconcileChildhood(future, room, isFuture);
    if (current) await this.reconcileChildhood(current, room, isCurrent);
    if (past) await this.reconcileChildhood(past, room, isPast);

    if (isCurrent) this.scheduleRegroup(room, session, session.end);
    if (isFuture) this.scheduleRegroup(room, session, session.open);
  }

  private async reconcileState({ id, local: room }: Room, expected: StateEventInput) {
    const { type, state_key: key, content: to } = expected;
    debug("🗄️ Get state", { room, type, key });
    const from = await this.matrix.getRoomStateEvent(id, type, key).catch(orNone);

    if (!isEqual(from, to)) {
      info("🗄️ Set state", { room, type, key, from, to });
      await this.matrix.sendStateEvent(id, type, key ?? "", to);
    }
  }

  private async reconcileTopic(room: Room) {
    const content = room.topic && { topic: room.topic };
    if (content) await this.reconcileState(room, { type: "m.room.topic", content });
  }

  private async removeFromSpace(space: ListedSpace, id: string, local?: string) {
    info("🏘️ Remove from space", { space: space.local, child: local ?? id });
    await space.removeChildRoom(id);
    this.#spaceByChild.delete(id);
  }

  private resolveAvatar(name: string = "default"): string {
    return expect(this.plan.avatars[name], `avatar ${name}`);
  }

  private scheduleReconcile(at: DateTime) {
    const delay = at.diffNow("milliseconds").valueOf();
    if (delay > maxDelay) throw new Error(`Not implemented for delay ${delay}`);

    if (this.#scheduledReconcile) {
      debug("🕓 Unschedule reconcile", { at: this.#scheduledReconcile.at.toISO() });
      clearTimeout(this.#scheduledReconcile.timer);
      this.#scheduledReconcile = undefined;
    }

    debug("🕓 Schedule reconcile", { at: at.toISO() });
    const task = () => {
      this.#scheduledReconcile = undefined;

      debug("🕓 Run scheduled reconcile");
      this.reconcile(at);
    };
    this.#scheduledReconcile = { at, timer: setTimeout(task, delay) };
  }

  private scheduleRegroup(room: Room, session: Session, at: DateTime) {
    if (!this.#scheduledReconcile) throw new Error("Next reconciliation time is unknown");
    if (this.#scheduledReconcile.at <= at) return;

    const delay = at.diffNow("milliseconds").valueOf();
    if (delay > maxDelay) throw new Error(`Not implemented for delay ${delay}`);

    const existing = this.#scheduledRegroups.get(room.id);
    if (existing) {
      debug("🕓 Unschedule regroup", { room: room.local, at: existing.at.toISO() });
      clearTimeout(existing.timer);
      this.#scheduledRegroups.delete(room.id);
    }

    debug("🕓 Schedule regroup", { room: room.local, at: at.toISO() });
    const task = () => {
      this.#scheduledRegroups.delete(room.id);

      debug("🕓 Run scheduled regroup", { room: room.local, at: at.toISO() });
      this.reconcileSessionGroups(room, session, at);
    };
    this.#scheduledRegroups.set(room.id, { at, timer: setTimeout(task, delay) });
  }
}
