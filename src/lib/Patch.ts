import assert from "assert/strict";
import { Permalinks, SimpleFsStorageProvider } from "matrix-bot-sdk";
import Client from "./Client.js";
import Commands from "./Commands.js";
import Concierge from "./Concierge.js";
import type { Event } from "./matrix.js";
import type { Plan } from "./Plan.js";
import Reconciler from "./Reconciler.js";
import { logger } from "./utilities.js";

const { debug, info, warn } = logger("Patch");

interface Config {
  accessToken: string;
  baseUrl: string;
  plan: Plan;
}

const badBot = /\bbad bot\b/i;
const goodBot = /\bgood bot\b/i;

export default class Patch {
  readonly #commands: Commands;
  readonly #concierge: Concierge;
  readonly #matrix: Client;
  readonly #plan: Plan;
  readonly #reconciler: Reconciler;
  public controlRoom: string | undefined;

  public constructor({ accessToken, baseUrl, plan }: Config) {
    const storage = new SimpleFsStorageProvider("state/state.json");

    this.#matrix = new Client(baseUrl, accessToken, storage);
    this.#plan = plan;
    this.#reconciler = new Reconciler(this, this.#matrix, this.#plan);
    this.#concierge = new Concierge(this.#matrix, this.#reconciler);
    this.#commands = new Commands(this, this.#matrix, this.#plan);

    this.#matrix.on("room.event", this.handleRoomEvent.bind(this));
    this.#matrix.on("room.leave", this.handleLeave.bind(this));
    this.#matrix.on("room.message", this.handleMessage.bind(this));
  }

  public async start() {
    info("🪪 Authenticate", { user: this.#plan.steward.id });
    assert.equal(await this.#matrix.getUserId(), this.#plan.steward.id);

    info("📥 Sync");
    await this.#matrix.start();
    debug("📥 Completed sync");

    await this.#reconciler.start();
    await this.#concierge.start();
    await this.#commands.start();
  }

  private async handleBadBot(room: string, event: Event<"m.room.message">) {
    warn("🤖 Bad bot", { room, sender: event.sender, message: event.content.body });

    if (this.controlRoom) {
      const pill = Permalinks.forEvent(room, event.event_id);
      await this.#matrix.sendHtmlNotice(this.controlRoom, `Negative feedback: ${pill}`);
    }
  }

  private async handleGoodBot(room: string, event: Event<"m.room.message">) {
    info("🤖 Good bot", { room, sender: event.sender, message: event.content.body });

    await this.#matrix.sendEvent(room, "m.reaction", {
      "m.relates_to": { rel_type: "m.annotation", key: "🤖", event_id: event.event_id },
    });
  }

  private handleLeave(roomId: string, event: Event<"m.room.member">) {
    if (event.sender === this.#plan.steward.id) return;

    warn("👮 Got kicked", { roomId, event });
  }

  private async handleMessage(room: string, event: Event<"m.room.message">) {
    if (event.sender === this.#plan.steward.id) return;

    if (badBot.test(event.content.body)) await this.handleBadBot(room, event);
    if (goodBot.test(event.content.body)) await this.handleGoodBot(room, event);
  }

  private async handleRoomEvent(room: string, event: Event) {
    if (event.sender === this.#plan.steward.id) return;

    debug("🧾 Send read receipt", { room, event: event.event_id, sender: event.sender });
    await this.#matrix.sendReadReceipt(room, event.event_id);
  }
}
