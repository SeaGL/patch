import { DateTime, Duration } from "luxon";
import type { MembershipEvent } from "matrix-bot-sdk";
import type Client from "../lib/Client.js";
import type { Event, StateEvent } from "../lib/matrix.js";
import type Patch from "../Patch.js";
import type { Log } from "../Patch.js";
import type Reconciler from "./Reconciler.js";
import type { Scheduled } from "../lib/scheduling.js";

interface ScheduledNudge extends Scheduled {
  children: Set<string>;
}

const nudgeDelay = Duration.fromObject({ minutes: 1 });

export default class Concierge {
  #scheduledNudges: Map<string, ScheduledNudge>;

  public trace: Log;
  public debug: Log;
  public error: Log;
  public info: Log;
  public warn: Log;

  public constructor(
    patch: Patch,
    private readonly matrix: Client,
    private readonly reconciler: Reconciler
  ) {
    this.#scheduledNudges = new Map();

    this.trace = patch.trace.bind(patch);
    this.debug = patch.debug.bind(patch);
    this.error = patch.error.bind(patch);
    this.info = patch.info.bind(patch);
    this.warn = patch.warn.bind(patch);
  }

  public async start() {
    this.matrix.on("room.event", this.handleRoomEvent.bind(this));
  }

  private async getMembership(
    room: string,
    user: string
  ): Promise<MembershipEvent["membership"] | undefined> {
    this.debug("🚪 Get memberships", { room });
    const memberships = await this.matrix.getRoomMembers(room);

    return memberships.find((m) => m.membershipFor === user)?.membership;
  }

  private async handleMembership(
    room: string,
    { state_key: user, content: { membership } }: StateEvent<"m.room.member">
  ) {
    this.debug("🚪 Membership", { room, user, membership });

    if (membership === "join" || membership === "leave") {
      const parent = this.reconciler.getParent(room);

      if (parent) {
        if (membership === "join") this.scheduleNudge(user, parent, room);
        else this.unscheduleNudge(user, parent, room);
      }
    }
  }

  private handleRoomEvent(room: string, event: Event) {
    if (event.type === "m.room.member") this.handleMembership(room, event);
  }

  private scheduleNudge(user: string, space: string, child: string) {
    const key = `${space}/${user}`;
    const existing = this.#scheduledNudges.get(key);

    const at = DateTime.now().plus(nudgeDelay);
    const delay = nudgeDelay.toMillis();

    if (existing) {
      this.debug("🕓 Reschedule nudge", { space, user, child, at: at.toISO() });
      clearTimeout(existing.timer);
      existing.at = at;
      existing.children.add(child);
      existing.timer = setTimeout(() => {
        this.#scheduledNudges.delete(key);

        this.debug("🕓 Run scheduled nudge", { space, user, at: at.toISO() });
        this.tryNudge(user, space);
      }, delay);
      this.#scheduledNudges.set(key, existing);
    } else {
      this.debug("🕓 Schedule nudge", { space, user, child, at: at.toISO() });
      const scheduled: ScheduledNudge = {
        at,
        children: new Set([child]),
        timer: setTimeout(() => {
          this.#scheduledNudges.delete(key);

          this.debug("🕓 Run scheduled nudge", { space, user, at: at.toISO() });
          this.tryNudge(user, space);
        }, delay),
      };
      this.#scheduledNudges.set(key, scheduled);
    }
  }

  private async tryNudge(user: string, space: string) {
    const membership = await this.getMembership(space, user);
    if (membership) return this.debug("🧭 No nudge", { user, space, membership });

    this.info("🧭 Nudge", { user, space });
    await this.matrix.inviteUser(user, space);
  }

  private unscheduleNudge(user: string, space: string, child: string) {
    const key = `${space}/${user}`;
    const existing = this.#scheduledNudges.get(key);
    if (!existing) return;

    if (existing.children.delete(child))
      this.debug("🕓 Remove nudge trigger", { space, user, child });

    if (existing.children.size === 0) {
      this.debug("🕓 Unschedule nudge", { space, user, at: existing.at.toISO() });
      clearTimeout(existing.timer);
      this.#scheduledNudges.delete(key);
    }
  }
}
