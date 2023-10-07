import Command from "../lib/Command.js";
import { IStateEvent, orNone } from "../lib/matrix.js";
import type { Handler } from "../modules/Commands.js";
import { escapeHtml } from "../lib/utilities.js";

interface QA {
  questions: {
    html: string;
    submitter: string;
  }[];
}

export type QAEvent = IStateEvent<"org.seagl.patch.qa", QA>;

export default class extends Command {
  public async start() {
    this.on("ask", this.ask);
    this.on("qa", this.show);
    this.on("qa-clear", this.reset);
  }

  // Adapted from https://github.com/treedavies/seagl-bot-2021/tree/58a07cb/plugins/ask
  private ask: Handler = async ({ docs, event, input, room }): Promise<void> => {
    const html = input.html ?? escapeHtml(input.text);

    if (html.length === 0)
      return void (await this.matrix.replyHtmlNotice(room, event, docs.commands["ask"]!));

    const qa = await this.#get(room);
    qa.questions.push({ html, submitter: event.sender });
    await this.#set(room, qa);

    await this.matrix.react(room, event.event_id, "✔️");
  };

  private reset: Handler = async ({ event, room }) => {
    await this.#set(room, this.#default());

    await this.matrix.react(room, event.event_id, "✔️");
  };

  private show: Handler = async ({ event, room }) => {
    const qa = await this.#get(room);

    const html =
      qa.questions.length === 0
        ? "No questions have been <code>!ask</code>ed."
        : `<p>Questions:</p><ol>${qa.questions
            .map((q) => `<li>${q.html} (from ${q.submitter})</li>`)
            .join("")}</ol>`;

    await this.matrix.replyHtmlNotice(room, event, html);
  };

  #default = (): QA => ({
    questions: [],
  });

  #get = async (room: string): Promise<QA> => {
    this.debug("✋ Get QA", { room });
    const existing = await this.matrix
      .getRoomStateEvent<QAEvent>(room, "org.seagl.patch.qa")
      .catch(orNone);
    return existing ?? this.#default();
  };

  #set = async (room: string, qa: QA) => {
    this.debug("✋ Set QA", { room, qa });
    await this.matrix.sendStateEvent<QAEvent>(room, "org.seagl.patch.qa", "", qa);
  };
}
