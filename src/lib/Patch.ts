import assert from "assert/strict";
import { RoomEvent, SimpleFsStorageProvider } from "matrix-bot-sdk";
import Client from "./Client.js";
import type { Plan } from "./Plan.js";
import Reconciler from "./Reconciler.js";
import { info, warn } from "./utilities.js";

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
    info("🪪 Authenticate: %j", { user: this.#plan.user });
    assert.equal(await this.#matrix.getUserId(), this.#plan.user);

    await this.reconcile();

    info("🟢 Start");
    await this.#matrix.start();
  }

  private handleLeave(roomId: string, event: RoomEvent) {
    if (event.sender === this.#plan.user) return;

    warn("👮 Got kicked: %j", { roomId, event });
  }

  private async reconcile() {
    await new Reconciler(this.#matrix, this.#plan).reconcile();
  }
}
