import type { DateTime } from "luxon";

export interface Scheduled {
  at: DateTime;
  timer: NodeJS.Timeout;
}
