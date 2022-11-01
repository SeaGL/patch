import { DateTime, Duration } from "luxon";
import type Client from "./Client.js";
import type { Event, StateEvent } from "./matrix.js";
import type Reconciler from "./Reconciler.js";
import type { Scheduled } from "./scheduling.js";
import { logger } from "./utilities.js";

const { debug, info } = logger("Concierge");

interface ScheduledNudge extends Scheduled {
  children: Set<string>;
}

const nudgeDelay = Duration.fromObject({ minutes: 1 });

export default class Concierge {
  #scheduledNudges: Map<string, ScheduledNudge>;

  public constructor(
    private readonly matrix: Client,
    private readonly reconciler: Reconciler
  ) {
    this.#scheduledNudges = new Map();
  }

  public async start() {
    this.matrix.on("room.event", this.handleRoomEvent.bind(this));
  }

  private async getMembership(room: string, user: string): Promise<string | undefined> {
    debug("🚪 Get memberships", { room });
    const memberships = await this.matrix.getRoomMembers(room);

    return memberships.find((m) => m.membershipFor === user)?.membership;
  }

  private handleMembership(
    room: string,
    { state_key: user, content: { membership } }: StateEvent<"m.room.member">
  ) {
    debug("🚪 Membership", { room, user, membership });

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
      debug("🕓 Reschedule nudge", { space, user, child, at: at.toISO() });
      clearTimeout(existing.timer);
      existing.at = at;
      existing.children.add(child);
      existing.timer = setTimeout(() => {
        this.#scheduledNudges.delete(key);

        debug("🕓 Run scheduled nudge", { space, user, at: at.toISO() });
        this.tryNudge(user, space);
      }, delay);
      this.#scheduledNudges.set(key, existing);
    } else {
      debug("🕓 Schedule nudge", { space, user, child, at: at.toISO() });
      const scheduled: ScheduledNudge = {
        at,
        children: new Set([child]),
        timer: setTimeout(() => {
          this.#scheduledNudges.delete(key);

          debug("🕓 Run scheduled nudge", { space, user, at: at.toISO() });
          this.tryNudge(user, space);
        }, delay),
      };
      this.#scheduledNudges.set(key, scheduled);
    }
  }

  private async tryNudge(user: string, space: string) {
    const membership = await this.getMembership(space, user);
    if (membership) return debug("🧭 Nudge unnecessary", { user, space, membership });

    info("🧭 Nudge", { user, space });
    await this.matrix.inviteUser(user, space);
  }

  private unscheduleNudge(user: string, space: string, child: string) {
    const key = `${space}/${user}`;
    const existing = this.#scheduledNudges.get(key);
    if (!existing) return;

    if (existing.children.delete(child))
      debug("🕓 Remove nudge trigger", { space, user, at: existing.at.toISO(), child });

    if (existing.children.size === 0) {
      debug("🕓 Unschedule nudge", { space, user, at: existing.at.toISO() });
      clearTimeout(existing.timer);
      this.#scheduledNudges.delete(key);
    }
  }
}
