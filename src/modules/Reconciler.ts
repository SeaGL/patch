import Bottleneck from "bottleneck";
import isEqual from "lodash.isequal";
import mergeWith from "lodash.mergewith";
import { DateTime, Duration } from "luxon";
import type {
  MatrixProfileInfo,
  PowerLevelsEventContent as PowerLevels,
  Space,
  SpaceEntityMap as Children,
} from "matrix-bot-sdk";
import MarkdownIt from "markdown-it";
import { assert, Equals } from "tsafe";
import type Client from "../lib/Client.js";
import type { RoomCreateOptions } from "../lib/Client.js";
import {
  IStateEvent,
  mergeWithMatrixState,
  MessageEvent,
  moderatorLevel,
  orNone,
  resolvePreset,
  StateEvent,
  StateEventInput,
} from "../lib/matrix.js";
import Module from "../lib/Module.js";
import type { Plan, SessionGroupId } from "../lib/Plan.js";
import * as Pretalx from "../lib/Pretalx.js";
import type { Scheduled } from "../lib/scheduling.js";
import {
  expect,
  maxDelay,
  optional,
  populate,
  present,
  unimplemented,
} from "../lib/utilities.js";
import type Patch from "../Patch.js";

const md = new MarkdownIt();

type Child = Inclusion | Room;

interface Inclusion {
  alias: string;
  id: string;
  order: string;
  suggested?: boolean;
}

interface Room extends Plan.Room, RoomID {
  order: string;
}

export interface RoomID {
  id: string;
  local: string;
}

interface ListedSpace extends Space {
  children: Children;
  room: Room;
}

interface Session extends Pretalx.Talk {
  scheduled?: NonNullable<Pretalx.Talk["scheduled"]> & {
    day: number;
    open: DateTime;
  };
}

export type IntroEvent = IStateEvent<"org.seagl.patch.intro", { message?: string }>;

export type InvitationReason = "attendant" | "nudge" | "private" | "static" | "view";

export type InvitationsEvent = IStateEvent<
  "org.seagl.patch.invitations",
  Record<string, InvitationReason[]>
>;

export type RedirectEvent = IStateEvent<"org.seagl.patch.redirect", { message?: string }>;

export type TagEvent = IStateEvent<"org.seagl.patch.tag", { tag?: string }>;

const jitsiUrl =
  "https://app.element.io/jitsi.html?confId=$conferenceId#conferenceDomain=$domain&conferenceId=$conferenceId&displayName=$matrix_display_name&avatarUrl=$matrix_avatar_url&userId=$matrix_user_id&roomId=$matrix_room_id&theme=$theme&roomName=$roomName";
const reconcilePeriod = Duration.fromObject({ hours: 1 });
const widgetLayout = {
  widgets: { "org.seagl.patch": { container: "top", height: 25, width: 100, index: 0 } },
};

const compareSessions = (a: Session, b: Session): number => {
  const sa = a.scheduled;
  const sb = b.scheduled;

  return sa && sb
    ? sa.beginning !== sb.beginning
      ? sa.beginning.valueOf() - sb.beginning.valueOf()
      : sa.end !== sb.end
        ? sa.end.valueOf() - sb.end.valueOf()
        : a.title.localeCompare(b.title)
    : !sa && !sb
      ? a.title.localeCompare(b.title)
      : sa
        ? -1
        : 1;
};
const sortKey = (index: number): string => String(10 * (1 + index)).padStart(4, "0");

export default class extends Module {
  #limiter: Bottleneck;
  #privateChildrenByParent: Map<RoomID["id"], Map<RoomID["id"], Room>>;
  #publicSpaceByChild: Map<RoomID["id"], RoomID>;
  #roomByTag: Map<string, RoomID["id"]>;
  #scheduledReconcile: Scheduled | undefined;
  #scheduledRegroups: Map<RoomID["id"], Scheduled>;
  #sessionGroups: { [id in SessionGroupId]?: ListedSpace };
  #sharedWithAttendants: Map<RoomID["id"], Room>;

  public constructor(
    patch: Patch,
    matrix: Client,
    private readonly plan: Plan,
  ) {
    super(patch, matrix);

    this.#limiter = new Bottleneck({ maxConcurrent: 1 });
    this.#privateChildrenByParent = new Map();
    this.#publicSpaceByChild = new Map();
    this.#roomByTag = new Map();
    this.#scheduledRegroups = new Map();
    this.#sessionGroups = {};
    this.#sharedWithAttendants = new Map();
  }

  public async addInvitations(
    room: RoomID,
    reason: InvitationReason,
    invitees: Set<string>,
  ) {
    await this.reconcileInvitationsByReason(room, reason, invitees, "add");
  }

  public getPublicParent(child: string): RoomID | undefined {
    return this.#publicSpaceByChild.get(child);
  }

  public async reconcile(now = DateTime.local({ zone: this.plan.timeZone })) {
    await this.#limiter.schedule(async () => {
      this.scheduleReconcile(now.plus(reconcilePeriod));

      this.info("🔃 Reconcile");
      await this.reconcileProfile(this.plan.steward);
      const inheritedUsers = await this.getInheritedUsers();
      if (this.plan.rooms) await this.reconcileRooms(inheritedUsers, this.plan.rooms);
      if (this.plan.sessions)
        await this.reconcileSessions(this.plan.sessions, inheritedUsers, now);
      this.debug("🔃 Completed reconciliation");
    });
  }

  public async removeInvitations(
    room: RoomID,
    reason: InvitationReason,
    invitees: Set<string>,
  ) {
    await this.reconcileInvitationsByReason(room, reason, invitees, "remove");
  }

  public async start() {
    for (const room of await this.matrix.getJoinedRooms()) {
      const tag = await this.getTag(room);
      if (tag) this.#roomByTag.set(tag, room);
    }

    await this.reconcile();

    this.patch.on("membership", this.handleMembership.bind(this));
  }

  private getAccessOptions({
    isPrivate,
    isSpace,
    parent,
  }: {
    isPrivate: boolean;
    isSpace: boolean;
    parent: Room | undefined;
  }): Pick<RoomCreateOptions, "initial_state" | "preset"> {
    return {
      preset: isPrivate || parent?.private ? "private_chat" : "public_chat",
      initial_state: isPrivate
        ? [{ type: "m.room.join_rules", content: { join_rule: "knock" } }]
        : parent?.private
          ? [
              {
                type: "m.room.join_rules",
                content: {
                  join_rule: "knock_restricted",
                  allow: [{ type: "m.room_membership", room_id: parent.id }],
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

  private async getInheritedUsers(): Promise<PowerLevels["users"]> {
    const plan = this.plan.inheritUserPowerLevels;
    if (!plan) return undefined;

    const users: PowerLevels["users"] = {};

    for (const [room, { raiseTo = 0 }] of Object.entries(plan)) {
      const id = await this.matrix.resolveRoom(room);

      this.debug("🛡️ Get power levels", { room });
      const { users: explicit = {}, users_default: defaultLevel = 0 } = expect(
        await this.matrix.getRoomStateEvent<StateEvent<"m.room.power_levels">>(
          id,
          "m.room.power_levels",
        ),
        "power levels",
      );

      this.debug("🚪 Get memberships", { room });
      const implicit = Object.fromEntries(
        (await this.matrix.getRoomMembers(id))
          .filter((m) => ["invite", "join"].includes(m.membership))
          .map((m) => [m.membershipFor, defaultLevel]),
      );

      this.debug("🛡️ Inherit user power levels", { room, explicit, implicit, raiseTo });
      for (const [user, level] of Object.entries({ ...implicit, ...explicit }))
        users[user] = Math.min(99, Math.max(users[user] ?? 0, level, raiseTo));
    }

    return users;
  }

  private async getModerators(room: string): Promise<string[]> {
    const powerLevels = expect(
      await this.matrix.getRoomStateEvent<StateEvent<"m.room.power_levels">>(
        room,
        "m.room.power_levels",
      ),
      "power levels",
    );

    return Object.entries(powerLevels.users ?? {})
      .filter(([_user, level]) => level >= moderatorLevel)
      .map(([user]) => user);
  }

  private async getNotice(
    room: RoomID,
    id: string,
  ): Promise<MessageEvent<"m.room.message"> | undefined> {
    this.debug("🪧 Get notice", { room: room.local, id });
    return await this.matrix.getEvent(room.id, id).catch(orNone);
  }

  private getPowerLevels(inherited: PowerLevels["users"], room: Plan.Room): PowerLevels {
    return {
      ...this.plan.powerLevels,
      events: {
        ...this.plan.powerLevels.events,
        ...(room.widget
          ? { "im.vector.modular.widgets": 99, "io.element.widgets.layout": 99 }
          : {}),
      },
      users: {
        ...inherited,
        ...this.plan.powerLevels.users,
      },
      ...(room.moderatorsOnly
        ? { events_default: 50 }
        : room.readOnly || room.redirect
          ? { events_default: 99 }
          : {}),
    };
  }

  private async getRootMessage(room: RoomID, id: string): Promise<string> {
    this.debug("💬 Get message", { room: room.local, id });
    const message: MessageEvent<"m.room.message"> | undefined = await this.matrix
      .getEvent(room.id, id)
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

    this.debug("🔖 Tag", { room: room, tag });
    return tag;
  }

  private async handleMembership(
    room: string,
    { state_key: user, content: { membership } }: StateEvent<"m.room.member">,
  ) {
    this.debug("🚪 Membership", { room, user, membership });

    if (membership === "join" && this.#privateChildrenByParent.has(room)) {
      for (const child of this.#privateChildrenByParent.get(room)?.values() ?? []) {
        await this.reconcilePrivateInvitations(child, { id: room, local: room });
      }
    }
  }

  private async reconcileInvitationsByReason(
    room: RoomID,
    reason: InvitationReason,
    invitees: Set<string>,
    operation: "add" | "remove" | "set" = "set",
  ) {
    this.debug("🚪 Get memberships", { reason, room: room.local });
    const memberships = await this.matrix.getRoomMembers(room.id);

    this.debug("🎟️ Get invitation reasons", { reason, room: room.local });
    const invitations =
      structuredClone(
        await this.matrix
          .getRoomStateEvent<InvitationsEvent>(room.id, "org.seagl.patch.invitations")
          .catch(orNone),
      ) ?? {};

    let changed = false;

    if (operation === "remove" || operation == "set") {
      for (const [invitee, reasons] of Object.entries(invitations)) {
        if (
          (operation === "remove" && invitees.has(invitee)) ||
          (operation === "set" && !invitees.has(invitee))
        ) {
          const index = reasons.indexOf(reason);
          if (index >= 0) {
            this.info("🎟️ Remove invitation reason", {
              room: room.local,
              invitee,
              reason,
            });
            if (reasons.length === 1) {
              delete invitations[invitee];
              const membership = memberships.find((m) => m.membershipFor === invitee);
              if (
                membership &&
                membership.membership === "invite" &&
                membership.sender === this.plan.steward.id
              ) {
                this.info("🎟️ Withdraw invitation", { room: room.local, invitee });
                await this.matrix.sendStateEvent(room.id, "m.room.member", invitee, {
                  membership: "leave",
                });
              }
            } else {
              reasons.splice(index, 1);
            }
            changed = true;
          }
        }
      }
    }

    if (operation === "add" || operation == "set") {
      for (const invitee of invitees) {
        const reasons = invitations[invitee] ?? [];
        if (!reasons.includes(reason)) {
          this.info("🎟️ Add invitation reason", { room: room.local, invitee, reason });
          reasons.push(reason);
          if (reasons.length === 1) {
            const membership = memberships.find((m) => m.membershipFor === invitee);
            if (
              !membership ||
              (membership.membership === "leave" &&
                membership.sender === this.plan.steward.id)
            ) {
              try {
                this.info("🎟️ Invite", { room: room.local, invitee });
                await this.matrix.inviteUser(invitee, room.id);
              } catch (error) {
                this.error("🎟️ Failed to invite", { room: room.local, invitee, error });
              }
            }
          }
          invitations[invitee] = reasons;
          changed = true;
        }
      }
    }

    if (changed)
      await this.reconcileState(room, {
        type: "org.seagl.patch.invitations",
        content: invitations,
      });
  }

  private async listSpace(room: Room, space: Space): Promise<ListedSpace> {
    this.debug("🏘️ List space", { space: room.local });
    return Object.assign(space, { children: await space.getChildEntities(), room });
  }

  private localToAlias(local: string): string {
    return `#${local}:${this.plan.homeserver}`;
  }

  private async reconcileAlias(room: Room, expected: string) {
    if (expected.endsWith(this.plan.homeserver)) {
      const resolved = await this.resolveAlias(expected);

      if (resolved && resolved !== room.id) {
        this.info("🏷️ Reassign alias", { alias: expected, from: resolved, to: room.id });
        await this.matrix.deleteRoomAlias(expected);
        await this.matrix.createRoomAlias(expected, room.id);
      } else if (!resolved) {
        this.info("🏷️ Create alias", { alias: expected, room: room.local });
        await this.matrix.createRoomAlias(expected, room.id);
      }
    }

    const proxy = this.plan.aliasProxy;
    const useProxy = proxy && expected.startsWith(`#${proxy.prefix}`);

    this.reconcileState(room, {
      type: "m.room.canonical_alias",
      content: {
        alias: useProxy
          ? expected
              .replace(/(?<=#)SeaGL/, "")
              .replace(`:${this.plan.homeserver}`, `:${proxy.homeserver}`)
          : expected,
        ...(useProxy ? { alt_aliases: [expected] } : {}),
      },
    });
  }

  private async reconcileAvatar(room: Room) {
    const content = { url: this.resolveAvatar(room.avatar) };
    await this.reconcileState(room, { type: "m.room.avatar", content });
  }

  private async reconcileChildhood(
    space: ListedSpace,
    child: Child,
    include = true,
    suggest?: boolean,
  ) {
    const { id, order, suggested = suggest ?? false } = child;
    const local = "local" in child ? child.local : child.alias;
    const actual = structuredClone(space.children[id]?.content);
    if (!include) return actual && (await this.removeFromSpace(space, child));

    const expected = { order, suggested };

    if (actual) {
      let changed = false;
      mergeWith(actual, expected, (from, to, option) => {
        if (typeof to === "object" || !(from || to) || from === to) return;

        this.info("🏘️ Update childhood", {
          space: space.room.local,
          child: local,
          option,
          from,
          to,
        });
        changed = true;
      });

      if (changed) {
        this.debug("🏘️ Set childhood", { space: space.room.local, child: local });
        await space.addChildRoom(id, actual);
      }
    } else {
      const via = optional(id.split(":", 2)[1]);
      this.info("🏘️ Add to space", { space: space.room.local, child: local, via });
      await space.addChildRoom(id, { via, ...expected });
    }
    if (space.room.private) this.#publicSpaceByChild.delete(id);
    else this.#publicSpaceByChild.set(id, { id: space.room.id, local: space.room.local });
    const privateChildren = this.#privateChildrenByParent.get(space.roomId) ?? new Map();
    if ("private" in child && child.private) privateChildren.set(child.id, child);
    else privateChildren.delete(child.id);
    this.#privateChildrenByParent.set(space.roomId, privateChildren);
  }

  private async reconcileChildren(space: ListedSpace, expected: Child[]) {
    const actual = Object.keys(space.children);
    const ids = new Set(expected.map((r) => r.id));

    for (const a of actual) if (!ids.has(a)) await this.removeFromSpace(space, a);
    for (const child of expected) await this.reconcileChildhood(space, child);
  }

  private async reconcileControlRoom(room: Room) {
    if (this.patch.controlRoom === room.id && !room.control) {
      this.warn("🚦 Unlink control room", { room: this.patch.controlRoom });
      this.patch.controlRoom = undefined;
    } else if (room.control && this.patch.controlRoom !== room.id) {
      this.info("🚦 Update control room", { from: this.patch.controlRoom, to: room.id });
      this.patch.controlRoom = room.id;
    }
  }

  private async reconcileExistence(
    inheritedUsers: PowerLevels["users"],
    expected: Plan.Room,
    parent?: Room,
    create: boolean = true,
  ): Promise<[string | undefined, boolean]> {
    const alias = this.localToAlias(expected.local);

    const existingByTag = expected.tag && this.resolveTag(expected.tag);
    const existingByAlias = await this.resolveAlias(alias);
    if (
      existingByTag &&
      existingByAlias &&
      existingByAlias !== existingByTag &&
      alias.endsWith(this.plan.homeserver)
    ) {
      this.info("🏷️ Delete alias", { alias });
      await this.matrix.deleteRoomAlias(alias);
    }
    const existing = existingByTag ?? existingByAlias;

    if (expected.destroy) {
      if (existing) {
        this.info("🏷️ Delete alias", { alias });
        await this.matrix.deleteRoomAlias(alias).catch(orNone);

        const reason = "Decommissioning room";
        const members = await this.matrix.getJoinedRoomMembers(existing);
        for (const user of members) {
          if (user === this.plan.steward.id) continue;

          this.info("🚪 Kick user", { room: existing, user, reason });
          await this.matrix.kickUser(user, existing, reason);
        }

        this.info("🚪 Leave room", { room: existing });
        await this.matrix.leaveRoom(existing);

        this.debug("📇 Forget room", { room: existing });
        await this.matrix.forgetRoom(existing);
      }

      return [undefined, false];
    } else if (existing) {
      return [existing, false];
    } else if (!create) {
      return [undefined, false];
    } else {
      this.info("🏠 Create room", { alias: expected.local });
      const isPrivate = Boolean(expected.private);
      const isSpace = present(expected.children);
      const avatar = this.resolveAvatar(expected.avatar);
      const tagEvent = expected.tag && {
        type: "org.seagl.patch.tag" as const,
        content: { tag: expected.tag },
      };
      const created = await this.matrix.createRoom(
        mergeWithMatrixState<RoomCreateOptions, Partial<RoomCreateOptions>>(
          {
            room_version: this.plan.defaultRoomVersion,
            room_alias_name: expected.local,
            name: expected.name,
            power_level_content_override: this.getPowerLevels(inheritedUsers, expected),
            initial_state: [
              { type: "m.room.avatar", content: { url: avatar } },
              { type: "m.room.canonical_alias", content: { alias } },
              ...(tagEvent ? [tagEvent] : []),
            ],
            ...(expected.topic ? { topic: expected.topic } : {}),
            ...(isSpace ? { creation_content: { type: "m.space" } } : {}),
          },
          this.getAccessOptions({ isPrivate, isSpace, parent }),
        ),
      );
      if (expected.tag) this.#roomByTag.set(expected.tag, created);
      return [created, true];
    }
  }

  private async reconcileIntro(room: Room) {
    const redactReason = "Removed introduction";

    const body = room.intro
      ? { html: md.render(room.intro), text: room.intro }
      : undefined;

    const event = await this.matrix
      .getRoomStateEvent<IntroEvent>(room.id, "org.seagl.patch.intro")
      .catch(orNone);
    const message = await this.reconcileNotice(room, event?.message, body, redactReason);

    await this.reconcileState(room, {
      type: "org.seagl.patch.intro",
      content: message ? { message } : {},
    });

    await this.reconcileState(room, {
      type: "m.room.pinned_events",
      content: message ? { pinned: [message] } : {},
    });
  }

  private async reconcileName(room: Room) {
    const content = { name: room.name };
    await this.reconcileState(room, { type: "m.room.name", content });
  }

  private async reconcileNotice(
    room: RoomID,
    id: string | undefined,
    expected: { html?: string; text: string } | undefined,
    redactionReason: string,
  ): Promise<string | undefined> {
    if (!expected) {
      if (id) await this.redactNotice(room, id, redactionReason);
      return;
    }

    const actual = id && (await this.getNotice(room, id))?.content.body;
    if (actual === expected.text) return id;

    if (actual) {
      return await this.replaceNotice(room, id, expected);
    } else {
      this.info("🪧 Notice", { room: room.local, body: expected });
      let content: MessageEvent<"m.room.message">["content"];
      if (expected.html) {
        content = {
          msgtype: "m.notice",
          body: expected.text,
          format: "org.matrix.custom.html",
          formatted_body: expected.html,
        };
      } else {
        content = {
          msgtype: "m.notice",
          body: expected.text,
        };
      }
      return await this.matrix.sendMessage(room.id, content);
    }
  }

  private async reconcilePowerLevels(inheritedUsers: PowerLevels["users"], room: Room) {
    const expected = this.getPowerLevels(inheritedUsers, room);

    this.debug("🛡️ Get power levels", { room: room.local });
    const actual = structuredClone(
      expect(
        await this.matrix.getRoomStateEvent<StateEvent<"m.room.power_levels">>(
          room.id,
          "m.room.power_levels",
        ),
        "power levels",
      ),
    );
    let changed = false;

    mergeWith(actual, expected, (from, to, ability) => {
      if (typeof to === "object" || from === to) return;

      this.info("🛡️ Update power level", { room: room.local, ability, from, to });
      changed = true;
    });

    if (changed) {
      this.debug("🛡️ Set power levels", { room: room.local, content: actual });
      await this.matrix.sendStateEvent(room.id, "m.room.power_levels", "", actual);
    }
  }

  private async reconcilePrivacy(room: Room, parent: Room | undefined) {
    type ImplementedFor = "initial_state" | "preset";

    const isPrivate = Boolean(room.private);
    const isSpace = Boolean(room.children);
    const options = this.getAccessOptions({ isPrivate, isSpace, parent });
    const expected = mergeWithMatrixState(resolvePreset(options.preset), options);
    assert<Equals<typeof expected, Pick<RoomCreateOptions, ImplementedFor>>>();

    if (expected.initial_state)
      for (const event of expected.initial_state) await this.reconcileState(room, event);
  }

  private async reconcilePrivateInvitations(child: Room, parent?: RoomID) {
    const invitees = new Set<string>();

    if (child.private) {
      if (parent) this.debug("🚪 Get memberships", { space: parent.local });
      const parentMemberships = parent && (await this.matrix.getRoomMembers(parent.id));

      this.debug("🛡️ List moderators", { room: (parent ?? child).local });
      const moderators = await this.getModerators((parent ?? child).id);

      for (const moderator of moderators)
        if (
          !parentMemberships ||
          parentMemberships.some(
            (m) => m.membership === "join" && m.membershipFor === moderator,
          )
        )
          invitees.add(moderator);
    }

    await this.reconcileInvitationsByReason(child, "private", invitees);
  }

  private async reconcileProfile({ avatar, name }: Plan["steward"]) {
    const user = this.plan.steward.id;

    this.debug("👤 Get profile", { user });
    const actual: MatrixProfileInfo = await this.matrix.getUserProfile(user);

    if (!(actual.displayname === name)) {
      this.info("👤 Set display name", { user, from: actual.displayname, to: name });
      await this.matrix.setDisplayName(name);
    }

    const url = this.resolveAvatar(avatar);
    if (!(actual.avatar_url === url)) {
      this.info("👤 Set avatar", { user, from: actual.avatar_url, to: url });
      await this.matrix.setAvatarUrl(url);
    }
  }

  private async reconcileRedirect(room: Room) {
    const alias = room.redirect && this.localToAlias(room.redirect);
    const body = alias ? { text: `↩️ This event takes place in ${alias}.` } : undefined;
    const redactReason = "Removed redirect";

    const type = "org.seagl.patch.redirect";
    const event = await this.matrix
      .getRoomStateEvent<RedirectEvent>(room.id, type)
      .catch(orNone);
    const message = await this.reconcileNotice(room, event?.message, body, redactReason);

    await this.reconcileState(room, { type, content: message ? { message } : {} });
  }

  private async reconcileRoom(
    inheritedUsers: PowerLevels["users"],
    order: string,
    expected: Plan.Room | Room,
    parent?: Room,
    create: boolean = true,
  ): Promise<Room | undefined> {
    let room: Room;
    if ("id" in expected) {
      room = expected;
    } else {
      const [id, created] = await this.reconcileExistence(
        inheritedUsers,
        expected,
        parent,
        create,
      );

      if (!id) {
        if (typeof expected.children === "object")
          await this.reconcileRooms(inheritedUsers, expected.children);

        return undefined;
      }

      room = { ...expected, id, order };

      if (!created) {
        await this.reconcileTag(room);
        await this.reconcileAlias(room, this.localToAlias(expected.local));
        await this.reconcilePowerLevels(inheritedUsers, room);
        await this.reconcilePrivacy(room, parent);
        await this.reconcileAvatar(room);
        await this.reconcileName(room);
        await this.reconcileTopic(room);
      }

      await this.reconcileWidget(room);
      await this.reconcileIntro(room);
      await this.reconcileRedirect(room);

      if (expected.inviteAttendants) this.#sharedWithAttendants.set(id, room);
      else this.#sharedWithAttendants.delete(id);
    }

    if (expected.children) {
      this.debug("🏘️ Get space", { alias: expected.local });
      const space = await this.matrix.getSpace(room.id);

      if (typeof expected.children === "string") {
        this.#sessionGroups[expected.children] = await this.listSpace(room, space);
      } else {
        await this.reconcileChildren(
          await this.listSpace(room, space),
          await this.reconcileRooms(inheritedUsers, expected.children, room),
        );
      }
    }

    if (!("id" in expected)) {
      await this.reconcileControlRoom(room);
      await this.reconcileStaticInvitations(room);
      await this.reconcilePrivateInvitations(room, parent);
      await this.removeOrphanedInvitations(room);
    }

    return room;
  }

  private async reconcileRooms(
    inheritedUsers: PowerLevels["users"],
    expected: Plan.Child[],
    parent?: Room,
  ): Promise<Child[]> {
    const children = [];

    for (const [index, child] of expected.entries()) {
      const order = sortKey(index);

      if (typeof child === "string") {
        const id = await this.resolveAlias(child);
        if (id) children.push({ alias: child, id, order });
      } else {
        const room = await this.reconcileRoom(inheritedUsers, order, child, parent);
        if (room) children.push(room);
      }
    }

    return children;
  }

  private async reconcileSessions(
    plan: Plan.Sessions,
    inheritedUsers: PowerLevels["users"],
    now: DateTime,
  ) {
    const ignore = new Set(plan.ignore ?? []);

    this.debug("📅 Get sessions", { event: plan.event });
    const talks = await Pretalx.getTalks(plan.event);
    const beginnings = talks.map((e) => e.scheduled?.beginning).filter(present);
    const startOfDay =
      beginnings.length > 0 ? DateTime.min(...beginnings).startOf("day") : undefined;
    const sessions = talks
      .filter((e) => !ignore.has(e.id))
      .map(({ scheduled, ...rest }) => ({
        ...rest,
        ...(startOfDay &&
          scheduled && {
            scheduled: {
              ...scheduled,
              day: scheduled.beginning.startOf("day").diff(startOfDay, "days").days,
              open: scheduled.beginning.minus({ minutes: plan.openEarly }),
            },
          }),
      }));
    sessions.sort(compareSessions);
    const venueRooms = sessions.reduce(
      (result, { scheduled }) => {
        if (scheduled)
          result[scheduled.roomId] ??= { name: scheduled.roomName, children: [] };
        return result;
      },
      {} as Record<string, { name: string; children: Room[] }>,
    );

    let demoOffset: Duration | undefined;
    if (plan.demo) {
      const dt = DateTime.fromISO(plan.demo, { zone: this.plan.timeZone });
      this.info("📅 Override conference date", {
        from: dt.toISODate(),
        to: now.toISODate(),
      });
      demoOffset = now.startOf("day").diff(dt, "days");
    }

    for (const [index, session] of sessions.entries()) {
      const { scheduled } = session;
      const suffix = plan.suffixes?.[session.id];
      if (!suffix) this.warn("🏷️ Missing alias suffix", { session: session.url });
      const redirect = plan.redirects?.[session.id];
      const values = {
        room: scheduled?.roomName ?? "Not scheduled",
        title: session.title,
        url: session.url,
      };
      const intro = populate(values, plan.intro);
      const topic = populate(values, plan.topic);
      const widget =
        scheduled && !redirect
          ? plan.widgets?.[scheduled.roomId]?.[scheduled.day]
          : undefined;

      const local = `${plan.prefix}${suffix ?? `session-${session.id}`}`;
      const room = await this.reconcileRoom(
        inheritedUsers,
        sortKey(index),
        {
          local,
          name: [
            ...(scheduled
              ? [
                  scheduled.beginning.toFormat("EEE HH:mm"),
                  scheduled.roomName.replace(/^(?:Room )?(?=\d+$)/, "R"),
                ]
              : ["Not scheduled"]),
            "·",
            session.title,
          ].join(" "),
          tag: `pretalx-talk-${session.id}`,
          ...(intro ? { intro } : {}),
          ...(redirect ? { redirect } : {}),
          ...(topic ? { topic } : {}),
          ...(widget ? { widget } : {}),
        },
        undefined,
        !!scheduled,
      );

      if (demoOffset && scheduled) {
        const to = scheduled.beginning.plus(demoOffset);
        this.debug("📅 Override session time", {
          id: session.id,
          from: scheduled.beginning.toISO(),
          to: to.toISO(),
        });
        scheduled.open = scheduled.open.plus(demoOffset);
        scheduled.beginning = to;
        scheduled.end = scheduled.end.plus(demoOffset);
      }

      if (room) {
        if (scheduled) venueRooms[scheduled.roomId]?.children.push(room);
        await this.reconcileSessionGroups(room, session, now);
      }
    }

    for (const [id, { children: roomChildren, name }] of Object.entries(venueRooms)) {
      const tag = `pretalx-room-${id}`;
      const local = `${plan.prefix}room-${id}`;
      const invitees = new Set(optional(this.plan.roomAttendants?.[id]));
      const children: Room[] = [
        ...this.#sharedWithAttendants.values(),
        ...roomChildren,
      ].map((r) => ({ ...r, suggested: true }));
      await this.reconcileView({ avatar: "room", local, name, tag, children }, invitees);
    }
  }

  private async reconcileSessionGroups(room: Room, session: Session, now: DateTime) {
    const {
      CURRENT_SESSIONS: current,
      FUTURE_SESSIONS: future,
      PAST_SESSIONS: past,
      UNSCHEDULED_SESSIONS: unscheduled,
    } = this.#sessionGroups;
    const { scheduled } = session;

    let [isFuture, isCurrent, isPast, isUnscheduled] = [false, false, false, !scheduled];

    if (scheduled) {
      const [opened, ended] = [scheduled.open <= now, scheduled.end <= now];
      [isFuture, isCurrent, isPast] = [!opened, opened && !ended, ended];
    }

    if (future) await this.reconcileChildhood(future, room, isFuture);
    if (current) await this.reconcileChildhood(current, room, isCurrent, true);
    if (past) await this.reconcileChildhood(past, room, isPast);
    if (unscheduled) await this.reconcileChildhood(unscheduled, room, isUnscheduled);

    const invitees = new Set(
      optional(scheduled && current && this.plan.roomAttendants?.[scheduled.roomId]),
    );
    await this.reconcileInvitationsByReason(room, "attendant", invitees);

    if (scheduled && isCurrent) this.scheduleRegroup(room, session, scheduled.end);
    if (scheduled && isFuture) this.scheduleRegroup(room, session, scheduled.open);
  }

  private async reconcileState(
    { id, local: room }: RoomID,
    expected: StateEventInput,
  ): Promise<boolean> {
    const { type, state_key: key, content: to } = expected;
    this.debug("🗄️ Get state", { room, type, key });
    const from = await this.matrix.getRoomStateEvent(id, type, key).catch(orNone);

    if (
      (Object.keys(from ?? {}).length > 0 || Object.keys(to).length > 0) &&
      !isEqual(from, to)
    ) {
      this.info("🗄️ Set state", { room, type, key, from, to });
      await this.matrix.sendStateEvent(id, type, key ?? "", to);
      return true;
    }

    return false;
  }

  private async reconcileStaticInvitations(room: Room) {
    const invitees = new Set(
      Object.values((room.inviteAttendants && this.plan.roomAttendants) || {}),
    );
    await this.reconcileInvitationsByReason(room, "static", invitees);
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

  private async reconcileView(view: Plan.Room, invitees: Set<string>) {
    // Space
    const room = await this.reconcileRoom(undefined, view.name, view);
    if (!room) return;

    // Invitations
    await this.reconcileInvitationsByReason(room, "view", invitees);
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

    await this.reconcileState(room, {
      type: "org.seagl.jitsi",
      content: room.widget
        ? "jitsi" in room.widget
          ? { id: room.widget.jitsi.id }
          : { disable: true }
        : room.redirect
          ? { disable: true }
          : {},
    });
  }

  private async redactNotice(room: RoomID, id: string, reason: string): Promise<string> {
    const root = await this.getRootMessage(room, id);

    this.info("🪧 Redact notice", { room: room.local, id, root, reason });
    return await this.matrix.redactEvent(room.id, root, reason);
  }

  private async removeFromSpace(space: ListedSpace, child: Child | string) {
    const id = typeof child === "string" ? child : child.id;
    const local =
      typeof child === "string" ? child : "local" in child ? child.local : child.alias;

    this.info("🏘️ Remove from space", { space: space.room.local, child: local });
    await space.removeChildRoom(id);
    this.#publicSpaceByChild.delete(id);
    const privateChildren = this.#privateChildrenByParent.get(space.roomId);
    if (privateChildren)
      if (privateChildren.delete(id))
        this.#privateChildrenByParent.set(space.roomId, privateChildren);
  }

  private async removeOrphanedInvitations(room: Room) {
    this.debug("🎟️ Get invitation reasons", { room: room.local });
    const invitations =
      (await this.matrix
        .getRoomStateEvent<InvitationsEvent>(room.id, "org.seagl.patch.invitations")
        .catch(orNone)) ?? {};

    this.debug("🚪 Get memberships", { room: room.local });
    const memberships = await this.matrix.getRoomMembers(room.id);

    for (const { membership, membershipFor: invitee, sender } of memberships) {
      if (
        membership === "invite" &&
        sender == this.plan.steward.id &&
        !(invitee in invitations)
      ) {
        this.info("🎟️ Withdraw orphaned invitation", { room: room.local, invitee });
        await this.matrix.sendStateEvent(room.id, "m.room.member", invitee, {
          membership: "leave",
        });
      }
    }
  }

  private async replaceNotice(
    room: RoomID,
    id: string,
    { html, text }: { html?: string; text: string },
  ): Promise<string> {
    const root = await this.getRootMessage(room, id);

    this.info("🪧 Replace notice", { room: room.local, id, root, text, html });
    return await this.matrix.replaceMessage(room.id, root, {
      msgtype: "m.notice",
      body: text,
      ...(html ? { format: "org.matrix.custom.html", formatted_body: html } : {}),
    });
  }

  private async resolveAlias(alias: string): Promise<string | undefined> {
    this.debug("🏷️ Resolve alias", { alias });
    return (await this.matrix.lookupRoomAlias(alias).catch(orNone))?.roomId;
  }

  private resolveAvatar(name: string = "default"): string {
    const result = expect(this.plan.avatars[name], `avatar ${name}`);
    return result.startsWith("mxc://") ? result : this.resolveAvatar(result);
  }

  private resolveTag(tag: string): string | undefined {
    this.debug("🔖 Resolve tag", { tag });
    return this.#roomByTag.get(tag);
  }

  private scheduleReconcile(at: DateTime) {
    const delay = at.diffNow("milliseconds").valueOf();
    if (delay > maxDelay) throw new Error(`Not implemented for delay ${delay}`);

    if (this.#scheduledReconcile) {
      this.debug("🕓 Unschedule reconcile", { at: this.#scheduledReconcile.at.toISO() });
      clearTimeout(this.#scheduledReconcile.timer);
      this.#scheduledReconcile = undefined;
    }

    this.debug("🕓 Schedule reconcile", { at: at.toISO() });
    const task = () => {
      this.#scheduledReconcile = undefined;

      this.debug("🕓 Run scheduled reconcile");
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
      this.debug("🕓 Unschedule regroup", { room: room.local, at: existing.at.toISO() });
      clearTimeout(existing.timer);
      this.#scheduledRegroups.delete(room.id);
    }

    this.debug("🕓 Schedule regroup", { room: room.local, at: at.toISO() });
    const task = () => {
      this.#scheduledRegroups.delete(room.id);

      this.debug("🕓 Run scheduled regroup", { room: room.local, at: at.toISO() });
      this.reconcileSessionGroups(room, session, at);
    };
    this.#scheduledRegroups.set(room.id, { at, timer: setTimeout(task, delay) });
  }
}
