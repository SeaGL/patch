import assert from "assert/strict";
import { RoomEvent, SimpleFsStorageProvider } from "matrix-bot-sdk";
import LimitedClient from "./LimitedClient.js";
import { info, warn } from "./utilities.js";

interface Config {
  accessToken: string;
  baseUrl: string;
  userId: string;
}

export default class Patch {
  readonly #matrix: LimitedClient;
  readonly #userId: string;

  public constructor({ accessToken, baseUrl, userId }: Config) {
    const storage = new SimpleFsStorageProvider("data/state.json");

    this.#matrix = new LimitedClient(baseUrl, accessToken, storage);
    this.#userId = userId;

    this.#matrix.on("room.leave", this.handleLeave.bind(this));
  }

  public async start() {
    assert.equal(await this.#matrix.getUserId(), this.#userId);

    await this.#matrix.start();
    info("🟢 Started: %j", { userId: this.#userId });
  }

  private handleLeave(roomId: string, event: RoomEvent) {
    if (event.sender === this.#userId) return;

    warn("👮 Got kicked: %j", { roomId, event });
  }
}
