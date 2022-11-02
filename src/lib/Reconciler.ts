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
  Event,
  IStateEvent,
  mergeWithMatrixState,
  orNone,
  resolvePreset,
  StateEvent,
  StateEventInput,
} from "./matrix.js";
import { getOsemEvents, OsemEvent } from "./Osem.js";
import type { Plan, RoomPlan, RoomsPlan, SessionGroupId, SessionsPlan } from "./Plan.js";
import type { Scheduled } from "./scheduling.js";
import { expect, logger, maxDelay, unimplemented } from "./utilities.js";

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
  day: number;
  open: DateTime;
}

export type RedirectEvent = IStateEvent<"org.seagl.patch.redirect", { message?: string }>;

export type TagEvent = IStateEvent<"org.seagl.patch.tag", { tag?: string }>;

const jitsiUrl =
  "https://app.element.io/jitsi.html?confId=$conferenceId#conferenceDomain=$domain&conferenceId=$conferenceId&displayName=$matrix_display_name&avatarUrl=$matrix_avatar_url&userId=$matrix_user_id&roomId=$matrix_room_id&theme=$theme&roomName=$roomName";
const reconcilePeriod = Duration.fromObject({ hours: 1 });
const widgetLayout = {
  widgets: { "org.seagl.patch": { container: "top", height: 25, width: 100, index: 0 } },
};

const compareSessions = (a: Session, b: Session): number =>
  a.beginning !== b.beginning
    ? a.beginning.valueOf() - b.beginning.valueOf()
    : a.end !== b.end
    ? a.end.valueOf() - b.end.valueOf()
    : a.title.localeCompare(b.title);
const sortKey = (index: number): string => String(10 * (1 + index)).padStart(4, "0");

export default class Reconciler {
  #privateChildrenByParent: Map<string, Set<string>>;
  #roomByTag: Map<string, string>;
  #scheduledReconcile: Scheduled | undefined;
  #scheduledRegroups: Map<Room["id"], Scheduled>;
  #sessionGroups: { [id in SessionGroupId]?: ListedSpace };
  #spaceByChild: Map<string, string>;

  public constructor(private readonly matrix: Client, private readonly plan: Plan) {
    this.#privateChildrenByParent = new Map();
    this.#roomByTag = new Map();
    this.#scheduledRegroups = new Map();
    this.#sessionGroups = {};
    this.#spaceByChild = new Map();
  }

  public getParent(child: string): string | undefined {
    return this.#spaceByChild.get(child);
  }

  public getPrivateChildren(parent: string): string[] {
    return [...(this.#privateChildrenByParent.get(parent) ?? [])];
  }

  public async start() {
    for (const room of await this.matrix.getJoinedRooms()) {
      const tag = await this.getTag(room);
      if (tag) this.#roomByTag.set(tag, room);
    }

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

  private async getNotice(
    room: string,
    id: string
  ): Promise<Event<"m.room.message"> | undefined> {
    debug("🪧 Get notice", { room, id });
    return await this.matrix.getEvent(room, id).catch(orNone);
  }

  private getPowerLevels({ readOnly, redirect, widget }: RoomPlan): PowerLevels {
    return {
      ...this.plan.powerLevels,
      events: {
        ...this.plan.powerLevels.events,
        ...(widget
          ? { "im.vector.modular.widgets": 99, "io.element.widgets.layout": 99 }
          : {}),
      },
      ...(readOnly || redirect ? { events_default: 50 } : {}),
    };
  }

  private async getRootMessage(room: string, id: string): Promise<string> {
    debug("💬 Get message", { room, id });
    const message: Event<"m.room.message"> | undefined = await this.matrix
      .getEvent(room, id)
      .catch(orNone);

    const relation = message?.content["m.relates_to"];
    const next = relation?.rel_type === "m.replace" && relation.event_id;

    return next ? this.getRootMessage(room, next) : id;
  }

  private async getTag(room: string): Promise<string | undefined> {
    const tag = (
      await this.matrix
        .getRoomStateEvent<TagEvent>(room, "org.seagl.patch.tag", "")
        .catch(orNone)
    )?.tag;

    debug("🔖 Tag", { room, tag });
    return tag;
  }

  private async listSpace(space: Space, local: string): Promise<ListedSpace> {
    debug("🏘️ List space", { local });
    return Object.assign(space, { children: await space.getChildEntities(), local });
  }

  private localToAlias(local: string): string {
    return `#${local}:${this.plan.homeserver}`;
  }

  private async reconcileAlias({ id }: Room, alias: string) {
    const resolved = await this.resolveAlias(alias);

    if (resolved && resolved !== id) {
      info("🏷️ Reassign alias", { alias, from: resolved, to: id });
      await this.matrix.deleteRoomAlias(alias);
      await this.matrix.createRoomAlias(alias, id);
    } else if (!resolved) {
      info("🏷️ Create alias", { alias, room: id });
      await this.matrix.createRoomAlias(alias, id);
    }

    const annotation = await this.matrix
      .getRoomStateEvent<StateEvent<"m.room.canonical_alias">>(
        id,
        "m.room.canonical_alias"
      )
      .catch(orNone);
    debug("🏷️ Aliases", {
      room: id,
      canonical: annotation?.alias,
      alternatives: annotation?.alt_aliases,
    });
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
    if (this.plan.sessions) await this.reconcileSessions(this.plan.sessions, now);
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
    const privateChildren = this.#privateChildrenByParent.get(space.roomId) ?? new Set();
    privateChildren[room.private ? "add" : "delete"](id);
    this.#privateChildrenByParent.set(space.roomId, privateChildren);
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
    const alias = this.localToAlias(local);

    const existingByTag = expected.tag && this.resolveTag(expected.tag);
    const existingByAlias = await this.resolveAlias(alias);
    if (existingByTag && existingByAlias && existingByAlias !== existingByTag) {
      info("🏷️ Delete alias", { alias });
      await this.matrix.deleteRoomAlias(alias);
    }
    const existing = existingByTag ?? existingByAlias;

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
      const tagEvent = expected.tag && {
        type: "org.seagl.patch.tag" as const,
        content: { tag: expected.tag },
      };
      const created = await this.matrix.createRoom(
        mergeWithMatrixState<RoomCreateOptions, Partial<RoomCreateOptions>>(
          {
            room_version: this.plan.defaultRoomVersion,
            room_alias_name: local,
            name: expected.name,
            power_level_content_override: this.getPowerLevels(expected),
            initial_state: [
              { type: "m.room.avatar", content: { url: avatar } },
              { type: "m.room.canonical_alias", content: { alias } },
              ...(tagEvent ? [tagEvent] : []),
            ],
            ...(expected.topic ? { topic: expected.topic } : {}),
            ...(isSpace ? { creation_content: { type: "m.space" } } : {}),
          },
          this.getAccessOptions({ isPrivate, isSpace, privateParent })
        )
      );
      if (expected.tag) this.#roomByTag.set(expected.tag, created);
      return [created, true];
    }
  }

  private async reconcileName(room: Room) {
    const content = { name: room.name };
    await this.reconcileState(room, { type: "m.room.name", content });
  }

  private async reconcileNotice(
    { id: room }: Room,
    id: string | undefined,
    expected: string | undefined,
    redactionReason: string
  ): Promise<string | undefined> {
    if (!expected) {
      if (id) await this.redactNotice(room, id, redactionReason);
      return;
    }

    const actual = id && (await this.getNotice(room, id))?.content.body;
    if (actual === expected) return id;

    if (actual) {
      return await this.replaceNotice(room, id, expected);
    } else {
      info("🪧 Notice", { room, body: expected });
      return await this.matrix.sendNotice(room, expected);
    }
  }

  private async reconcilePowerLevels(room: Room) {
    const expected = this.getPowerLevels(room);

    debug("🛡️ Get power levels", { room: room.local });
    const actual = expect(
      await this.matrix.getRoomStateEvent<StateEvent<"m.room.power_levels">>(
        room.id,
        "m.room.power_levels"
      ),
      "power levels"
    );
    let changed = false;

    mergeWith(actual, expected, (from, to, ability) => {
      if (typeof to === "object" || from === to) return;

      info("🛡️ Update power level", { room: room.local, ability, from, to });
      changed = true;
    });

    if (changed) {
      debug("🛡️ Set power levels", { room: room.local, content: actual });
      await this.matrix.sendStateEvent(room.id, "m.room.power_levels", "", actual);
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

  private async reconcileRedirect(room: Room) {
    const alias = room.redirect && this.localToAlias(room.redirect);
    const body = alias && `This event takes place in ${alias}.`;
    const redactReason = "Removed redirect";

    const type = "org.seagl.patch.redirect";
    const event = await this.matrix
      .getRoomStateEvent<RedirectEvent>(room.id, type)
      .catch(orNone);
    const message = await this.reconcileNotice(room, event?.message, body, redactReason);

    await this.reconcileState(room, { type, content: message ? { message } : {} });
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
      await this.reconcileTag(room);
      await this.reconcileAlias(room, this.localToAlias(local));
      await this.reconcilePowerLevels(room);
      await this.reconcilePrivacy(room, privateParent);
      await this.reconcileAvatar(room);
      await this.reconcileName(room);
      await this.reconcileTopic(room);
    }

    await this.reconcileWidget(room);
    await this.reconcileRedirect(room);

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

  private async reconcileSessions(plan: SessionsPlan, now: DateTime) {
    const ignore = new Set(plan.ignore ?? []);

    debug("📅 Get sessions", { conference: plan.conference });
    const osemEvents = await getOsemEvents(plan.conference);
    const startOfDay = DateTime.min(...osemEvents.map((e) => e.beginning)).startOf("day");
    const sessions = osemEvents
      .filter((e) => !ignore.has(e.id))
      .map((event) => ({
        ...event,
        day: event.beginning.startOf("day").diff(startOfDay, "days").days,
        open: event.beginning.minus({ minutes: plan.openEarly }),
      }));
    sessions.sort(compareSessions);
    if (plan.demo) {
      const dt = DateTime.fromISO(plan.demo, { zone: this.plan.timeZone });
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
      const suffix = plan.suffixes?.[session.id] ?? `session-${session.id}`;
      const redirect = plan.redirects?.[session.id];
      const widget = plan.widgets?.[session.room]?.[session.day];

      const room = await this.reconcileRoom(`${plan.prefix}${suffix}`, sortKey(index), {
        name: `${session.beginning.toFormat("EEE HH:mm")} ${session.title}`,
        tag: `osem-event-${session.id}`,
        topic: `Details: ${session.url}`,
        ...(redirect ? { redirect } : {}),
        ...(widget ? { widget } : {}),
      });

      if (room) await this.reconcileSessionGroups(room, session, now);
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

  private async reconcileState(
    { id, local: room }: Room,
    expected: StateEventInput
  ): Promise<boolean> {
    const { type, state_key: key, content: to } = expected;
    debug("🗄️ Get state", { room, type, key });
    const from = await this.matrix.getRoomStateEvent(id, type, key).catch(orNone);

    if (
      (Object.keys(from ?? {}).length > 0 || Object.keys(to).length > 0) &&
      !isEqual(from, to)
    ) {
      info("🗄️ Set state", { room, type, key, from, to });
      await this.matrix.sendStateEvent(id, type, key ?? "", to);
      return true;
    }

    return false;
  }

  private async reconcileTag(room: Room) {
    const changed = await this.reconcileState(room, {
      type: "org.seagl.patch.tag",
      content: room.tag ? { tag: room.tag } : {},
    });
    if (changed && room.tag) this.#roomByTag.set(room.tag, room.id);
  }

  private async reconcileTopic(room: Room) {
    const content = room.topic && { topic: room.topic };
    if (content) await this.reconcileState(room, { type: "m.room.topic", content });
  }

  private async reconcileWidget(room: Room) {
    await this.reconcileState(room, {
      type: "im.vector.modular.widgets",
      state_key: "org.seagl.patch",
      content: room.widget
        ? {
            avatar_url: this.resolveAvatar(room.widget.avatar),
            creatorUserId: this.plan.steward.id,
            name: room.widget.name ?? room.name,
            ...("custom" in room.widget
              ? { type: "customwidget", url: room.widget.custom }
              : "jitsi" in room.widget
              ? {
                  type: "jitsi",
                  url: jitsiUrl,
                  data: {
                    domain: this.plan.jitsiDomain,
                    conferenceId: room.widget.jitsi.id,
                    roomName: room.widget.jitsi.name,
                  },
                }
              : unimplemented(room.widget)),
          }
        : {},
    });

    await this.reconcileState(room, {
      type: "io.element.widgets.layout",
      content: room.widget ? widgetLayout : {},
    });
  }

  private async redactNotice(room: string, id: string, reason: string): Promise<string> {
    const root = await this.getRootMessage(room, id);

    info("🪧 Redact notice", { room, id, root, reason });
    return await this.matrix.redactEvent(room, root, reason);
  }

  private async removeFromSpace(space: ListedSpace, id: string, local?: string) {
    info("🏘️ Remove from space", { space: space.local, child: local ?? id });
    await space.removeChildRoom(id);
    this.#spaceByChild.delete(id);
    const privateChildren = this.#privateChildrenByParent.get(space.roomId);
    if (privateChildren)
      if (privateChildren.delete(id))
        this.#privateChildrenByParent.set(space.roomId, privateChildren);
  }

  private async replaceNotice(
    room: string,
    id: string,
    body: Event<"m.room.message">["content"]["body"]
  ): Promise<string> {
    const root = await this.getRootMessage(room, id);

    info("🪧 Replace notice", { room, id, root, body });
    const content = { msgtype: "m.notice", body };
    return await this.matrix.sendMessage(room, {
      ...content,
      "m.relates_to": { rel_type: "m.replace", event_id: root },
      "m.new_content": content,
    });
  }

  private async resolveAlias(alias: string): Promise<string | undefined> {
    debug("🏷️ Resolve alias", { alias });
    return (await this.matrix.lookupRoomAlias(alias).catch(orNone))?.roomId;
  }

  private resolveAvatar(name: string = "default"): string {
    return expect(this.plan.avatars[name], `avatar ${name}`);
  }

  private resolveTag(tag: string): string | undefined {
    debug("🔖 Resolve tag", { tag });
    return this.#roomByTag.get(tag);
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
