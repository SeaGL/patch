import { Permalinks } from "matrix-bot-sdk";
import type { Event } from "../lib/matrix.js";
import Module from "../lib/Module.js";

const badBot = /\bbad bot\b/i;
const goodBot = /\bgood bot\b/i;

export default class extends Module {
  public async start() {
    this.patch.on("kicked", this.kicked);

    this.patch.on("message", async (room, event) => {
      if (badBot.test(event.content.body)) await this.bad(room, event);
      else if (goodBot.test(event.content.body)) await this.good(room, event);
    });
  }

  private async bad(room: string, event: Event<"m.room.message">) {
    this.warn(
      "🤖 Bad bot",
      { room, sender: event.sender, message: event.content.body },
      `Negative feedback: ${Permalinks.forEvent(room, event.event_id)}`
    );
  }

  private async good(room: string, event: Event<"m.room.message">) {
    this.info("🤖 Good bot", { room, sender: event.sender, message: event.content.body });

    await this.matrix.react(room, event.event_id, "🤖");
  }

  private kicked(room: string, event: Event<"m.room.member">) {
    this.warn("🤖 Got kicked", { room, event });
  }
}
