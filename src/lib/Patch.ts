import assert from "assert/strict";
import { RoomEvent, SimpleFsStorageProvider } from "matrix-bot-sdk";
import LimitedClient from "./LimitedClient.js";

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
    console.info("🟢 Ready: %j", { userId: this.#userId });
  }

  private handleLeave(roomId: string, event: RoomEvent) {
    if (event.sender === this.#userId) return;

    console.warn("👮 Got kicked: %j", { roomId, event });
  }
}
