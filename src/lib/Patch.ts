import assert from "assert/strict";
import { SimpleFsStorageProvider } from "matrix-bot-sdk";
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

export default class Patch {
  readonly #commands: Commands;
  readonly #concierge: Concierge;
  readonly #matrix: Client;
  readonly #plan: Plan;
  readonly #reconciler: Reconciler;

  public constructor({ accessToken, baseUrl, plan }: Config) {
    const storage = new SimpleFsStorageProvider("data/state.json");

    this.#matrix = new Client(baseUrl, accessToken, storage);
    this.#plan = plan;
    this.#reconciler = new Reconciler(this.#matrix, this.#plan);
    this.#concierge = new Concierge(this.#matrix, this.#reconciler);
    this.#commands = new Commands(this.#matrix, this.#plan);

    this.#matrix.on("room.event", this.handleRoomEvent.bind(this));
    this.#matrix.on("room.leave", this.handleLeave.bind(this));
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

  private handleLeave(roomId: string, event: Event<"m.room.member">) {
    if (event.sender === this.#plan.steward.id) return;

    warn("👮 Got kicked", { roomId, event });
  }

  private async handleRoomEvent(room: string, event: Event) {
    if (event.sender === this.#plan.steward.id) return;

    debug("🧾 Send read receipt", { room, event: event.event_id });
    await this.#matrix.sendReadReceipt(room, event.event_id);
  }
}
