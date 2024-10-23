import { Permalinks } from "matrix-bot-sdk";
import type { MessageEvent, Received, StateEvent } from "../lib/matrix.js";
import Module from "../lib/Module.js";

const badBot = /\bbad bot\b/i;
const goodBot = /\bgood bot\b/i;

export default class extends Module {
  public async start() {
    this.patch.on("membership", async (room, event) => {
      if (event.state_key === this.patch.id && event.content.membership === "leave")
        this.kicked(room, event);
    });

    this.patch.on("message", async (room, event) => {
      if (badBot.test(event.content.body)) await this.bad(room, event);
      else if (goodBot.test(event.content.body)) await this.good(room, event);
    });
  }

  private async bad(room: string, event: Received<MessageEvent<"m.room.message">>) {
    this.warn(
      "🤖 Bad bot",
      { room, sender: event.sender, message: event.content.body },
      `Negative feedback: ${Permalinks.forEvent(room, event.event_id)}`,
    );
  }

  private async good(room: string, event: Received<MessageEvent<"m.room.message">>) {
    this.info("🤖 Good bot", { room, sender: event.sender, message: event.content.body });

    await this.matrix.react(room, event.event_id, "🤖");
  }

  private kicked(room: string, event: StateEvent<"m.room.member">) {
    this.warn("🤖 Got kicked", { room, event });
  }
}
