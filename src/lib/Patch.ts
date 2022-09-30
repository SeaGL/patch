import assert from "assert/strict";
import { RoomEvent, SimpleFsStorageProvider } from "matrix-bot-sdk";
import Client from "./Client.js";
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
  readonly #matrix: Client;
  readonly #plan: Plan;

  public constructor({ accessToken, baseUrl, plan }: Config) {
    const storage = new SimpleFsStorageProvider("data/state.json");

    this.#matrix = new Client(baseUrl, accessToken, storage);
    this.#plan = plan;

    this.#matrix.on("room.leave", this.handleLeave.bind(this));
  }

  public async start() {
    info("🪪 Authenticate", { user: this.#plan.steward.id });
    assert.equal(await this.#matrix.getUserId(), this.#plan.steward.id);

    info("📥 Sync");
    await this.#matrix.start();
    debug("📥 Completed sync");

    await this.reconcile();
  }

  private handleLeave(roomId: string, event: RoomEvent) {
    if (event.sender === this.#plan.steward.id) return;

    warn("👮 Got kicked", { roomId, event });
  }

  private async reconcile() {
    await new Reconciler(this.#matrix, this.#plan).reconcile();
  }
}
