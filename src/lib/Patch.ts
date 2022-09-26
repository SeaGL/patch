import assert from "assert/strict";
import { RoomEvent, SimpleFsStorageProvider } from "matrix-bot-sdk";
import Client from "./Client.js";
import Reconciler, { Plan } from "./Reconciler.js";
import { info, warn } from "./utilities.js";

interface Config {
  accessToken: string;
  baseUrl: string;
  plan: Plan;
  userId: string;
}

export default class Patch {
  readonly #matrix: Client;
  readonly #plan: Plan;
  readonly #userId: string;

  public constructor({ accessToken, baseUrl, plan, userId }: Config) {
    const storage = new SimpleFsStorageProvider("data/state.json");

    this.#matrix = new Client(baseUrl, accessToken, storage);
    this.#plan = plan;
    this.#userId = userId;

    this.#matrix.on("room.leave", this.handleLeave.bind(this));
  }

  public async start() {
    info("🪪 Authenticate: %j", { user: this.#userId });
    assert.equal(await this.#matrix.getUserId(), this.#userId);

    await this.reconcile();

    info("🟢 Start");
    await this.#matrix.start();
  }

  private handleLeave(roomId: string, event: RoomEvent) {
    if (event.sender === this.#userId) return;

    warn("👮 Got kicked: %j", { roomId, event });
  }

  private async reconcile() {
    await new Reconciler(this.#matrix, this.#userId, this.#plan).reconcile();
  }
}
