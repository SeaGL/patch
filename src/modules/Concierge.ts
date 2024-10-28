import { DateTime, Duration } from "luxon";
import type { MembershipEvent } from "matrix-bot-sdk";
import type { RoomID } from "./Reconciler.js";
import type { StateEvent } from "../lib/matrix.js";
import Module from "../lib/Module.js";
import type { Scheduled } from "../lib/scheduling.js";

interface ScheduledNudge extends Scheduled {
  children: Set<string>;
}

const nudgeDelay = Duration.fromObject({ minutes: 1 });

export default class extends Module {
  #scheduledNudges: Map<string, ScheduledNudge> = new Map();

  public async start() {
    this.patch.on("membership", this.handleMembership.bind(this));
  }

  private async getMembership(
    room: RoomID,
    user: string,
  ): Promise<MembershipEvent["membership"] | undefined> {
    this.debug("🚪 Get memberships", { room: room.local });
    const memberships = await this.matrix.getRoomMembers(room.id);

    return memberships.find((m) => m.membershipFor === user)?.membership;
  }

  private async handleMembership(
    room: string,
    { state_key: user, content: { membership } }: StateEvent<"m.room.member">,
  ) {
    this.debug("🚪 Membership", { room, user, membership });

    if (membership === "join" || membership === "leave") {
      const space = this.patch.getPublicCanonicalSpace(room);

      if (space) {
        if (membership === "join") this.scheduleNudge(user, space, room);
        else this.unscheduleNudge(user, space, room);
      }
    }
  }

  private scheduleNudge(user: string, space: RoomID, child: string) {
    const key = `${space}/${user}`;
    const existing = this.#scheduledNudges.get(key);

    const at = DateTime.now().plus(nudgeDelay);
    const delay = nudgeDelay.toMillis();

    if (existing) {
      this.debug("🕓 Reschedule nudge", {
        space: space.local,
        user,
        child,
        at: at.toISO(),
      });
      clearTimeout(existing.timer);
      existing.at = at;
      existing.children.add(child);
      existing.timer = setTimeout(() => {
        this.#scheduledNudges.delete(key);

        this.debug("🕓 Run scheduled nudge", {
          space: space.local,
          user,
          at: at.toISO(),
        });
        this.tryNudge(user, space);
      }, delay);
      this.#scheduledNudges.set(key, existing);
    } else {
      this.debug("🕓 Schedule nudge", {
        space: space.local,
        user,
        child,
        at: at.toISO(),
      });
      const scheduled: ScheduledNudge = {
        at,
        children: new Set([child]),
        timer: setTimeout(() => {
          this.#scheduledNudges.delete(key);

          this.debug("🕓 Run scheduled nudge", {
            space: space.local,
            user,
            at: at.toISO(),
          });
          this.tryNudge(user, space);
        }, delay),
      };
      this.#scheduledNudges.set(key, scheduled);
    }
  }

  private async tryNudge(user: string, space: RoomID) {
    const membership = await this.getMembership(space, user);
    if (membership)
      return this.debug("🧭 No nudge", { user, space: space.local, membership });

    this.info("🧭 Nudge", { user, space: space.local });
    await this.matrix.inviteUser(user, space.id);
  }

  private unscheduleNudge(user: string, space: RoomID, child: string) {
    const key = `${space}/${user}`;
    const existing = this.#scheduledNudges.get(key);
    if (!existing) return;

    if (existing.children.delete(child))
      this.debug("🕓 Remove nudge trigger", { space: space.local, user, child });

    if (existing.children.size === 0) {
      this.debug("🕓 Unschedule nudge", {
        space: space.local,
        user,
        at: existing.at.toISO(),
      });
      clearTimeout(existing.timer);
      this.#scheduledNudges.delete(key);
    }
  }
}
