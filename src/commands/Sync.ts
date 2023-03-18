import Command from "../lib/Command.js";
import { Group, Handler } from "../modules/Commands.js";

export default class Announce extends Command {
  public async start() {
    this.on("sync", this.sync, { group: Group.Control });
  }

  private sync: Handler = async ({ event, room }) => {
    const started = "Synchronizing space with data sources…";
    const completed = "Synchronized space with data sources";

    const start = await this.matrix.replyNotice(room, event, started);
    const complete = () => this.matrix.replaceNotice(room, start, { body: completed });

    this.patch.sync().then(complete);
  };
}
