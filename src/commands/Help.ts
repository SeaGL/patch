import Command from "../lib/Command.js";
import { Group, Handler } from "../modules/Commands.js";

export default class extends Command {
  public async start() {
    this.on("help", this.helpControlRoom, { group: Group.Control });
    this.on("help", this.helpPublic, { group: Group.Public });
  }

  private helpControlRoom: Handler = async ({ docs, event, matrix, room }) => {
    await matrix.replyHtmlNotice(room, event, docs.controlBrief);
  };

  private helpPublic: Handler = async ({ docs, event, matrix, room }) => {
    await matrix.replyHtmlNotice(room, event, docs.brief);
  };
}
