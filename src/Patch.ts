import assert from "assert/strict";
import { LogService as LS, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { TypedEmitter } from "tiny-typed-emitter";
import Client from "./lib/Client.js";
import type { Event, MessageEvent, Received, StateEvent } from "./lib/matrix.js";
import type { Plan } from "./lib/Plan.js";
import { escapeHtml } from "./lib/utilities.js";
import { version } from "./lib/version.js";
import Commands from "./modules/Commands.js";
import Concierge from "./modules/Concierge.js";
import Feedback from "./modules/Feedback.js";
import ReadReceipts from "./modules/ReadReceipts.js";
import Reconciler, { InvitationReason, RoomID } from "./modules/Reconciler.js";

interface Config {
  accessToken: string;
  baseUrl: string;
  plan: Plan;
}

interface Emissions {
  membership: (room: string, event: Received<StateEvent<"m.room.member">>) => void;
  message: (room: string, event: Received<MessageEvent<"m.room.message">>) => void;
  reaction: (room: string, event: Received<MessageEvent<"m.reaction">>) => void;
  readable: (room: string, event: Received<Event>) => void;
}

type Log = <D>(message: string, data?: D, notice?: string) => void;

export default class Patch extends TypedEmitter<Emissions> {
  static modules = [Commands, Concierge, Feedback, ReadReceipts];

  public controlRoom: string | undefined;
  public readonly id: string;

  readonly #matrix: Client;
  readonly #reconciler: Reconciler;

  public constructor({ accessToken, baseUrl, plan }: Config) {
    super();

    const storage = new SimpleFsStorageProvider("state/state.json");

    this.id = plan.steward.id;

    this.#matrix = new Client(baseUrl, accessToken, storage);
    this.#reconciler = new Reconciler(this, this.#matrix, plan);
  }

  trace: Log = (m, d) => LS.trace("Patch", m, d);
  debug: Log = (m, d) => LS.debug("Patch", m, d);
  info: Log = (m, d) => LS.info("Patch", m, d);
  warn: Log = (m, d, n) => (LS.warn("Patch", m, d), this.#alert("Warning")(m, d, n));
  error: Log = (m, d, n) => (LS.error("Patch", m, d), this.#alert("Error")(m, d, n));

  public async start() {
    this.info("▶️ Start", { version });

    this.info("🪪 Authenticate", { user: this.id });
    assert.equal(await this.#matrix.getUserId(), this.id);

    this.#matrix.on("room.event", this.#dispatch);

    this.info("📥 Sync");
    await this.#matrix.start();
    this.debug("📥 Completed sync");

    await this.#reconciler.start();
    await Promise.all(Patch.modules.map((M) => new M(this, this.#matrix).start()));
  }

  public getPublicCanonicalSpace(room: string): RoomID | undefined {
    return this.#reconciler.getPublicParent(room);
  }

  public invite(room: RoomID, reason: InvitationReason, invitees: Set<string>) {
    return this.#reconciler.addInvitations(room, reason, invitees);
  }

  public isControlRoom(room: string): boolean {
    return !!this.controlRoom && room === this.controlRoom;
  }

  public async sync() {
    await this.#reconciler.reconcile();
  }

  public uninvite(room: RoomID, reason: InvitationReason, invitees: Set<string>) {
    return this.#reconciler.removeInvitations(room, reason, invitees);
  }

  #alert =
    (level: string) =>
    <D>(message: string, data?: D, notice?: string) =>
      this.controlRoom &&
      this.#matrix.sendHtmlNotice(
        this.controlRoom,
        notice ??
          `<p><strong>${level}:</strong> ${escapeHtml(message)}</p>${
            data
              ? `<pre><code>${escapeHtml(
                  JSON.stringify(data, undefined, 2),
                )}</code></pre>`
              : ""
          }`,
      );

  #dispatch = (room: string, event: Received<Event>) => {
    if (event.sender === this.id) return;

    if (event.type === "m.reaction") this.emit("reaction", room, event);
    else if (event.type === "m.room.member") this.emit("membership", room, event);
    else if (event.type === "m.room.message") this.emit("message", room, event);

    this.emit("readable", room, event);
  };
}
