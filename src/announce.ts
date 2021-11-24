import Bottleneck from "bottleneck";
import { DateTime, Settings } from "luxon";
import {
  MatrixClient,
  MentionPill,
  RichReply,
  SimpleFsStorageProvider,
} from "matrix-bot-sdk";
import { AutoDiscovery } from "matrix-js-sdk";
import fetch from "node-fetch";
import { env } from "./utilities.js";

Settings.defaultZone = "America/Los_Angeles";

import { config } from "./config.js";
import { conferenceRooms } from "./roomLists/conferenceRooms.js";
import { testRooms } from "./roomLists/testRooms.js";

(async () => {
  // Rate limiter
  const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1 });
  limiter.on("failed", async (error, jobInfo) => {
    if (jobInfo.retryCount < 3 && error?.body?.errcode === "M_LIMIT_EXCEEDED") {
      const ms = error?.body?.retry_after_ms ?? 5000;

      console.warn(`Rate limited for ${ms} ms`);
      return ms;
    }
  });

  // Client
  const wellKnown = await AutoDiscovery.findClientConfig(config.homeserver);
  const baseUrl = wellKnown["m.homeserver"].base_url;
  const storage = new SimpleFsStorageProvider("data/state.json");
  const client = new MatrixClient(baseUrl, config.accessToken, storage);
  const getCustomData = async (roomId) => {
    try {
      return await limiter.schedule(() =>
        client.getRoomStateEvent(roomId, "org.seagl.2021roomgenerator", "")
      );
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND") {
        throw error;
      }
    }
  };
  const userId = await limiter.schedule(() => client.getUserId());
  const joinedRoomIds = new Set(
    await limiter.schedule(() => client.getJoinedRooms())
  );
  
  const mainSpace = await limiter.schedule(() => client.getSpace("#SeaGL:seattlematrix.org"));
  const mainSpacePill = (await MentionPill.forRoom(mainSpace.roomId, client)).html;
  
  const messageText = `<p>Thank you for an amazing SeaGL 2021!</p>
<p>Please join us in our year-round community space at <a href="https://matrix.to/#/#SeaGL:seattlematrix.org">#SeaGL:seattlematrix.org</a>.</p>
<p>To wrap up the conference:<br>
<ul>
<li>We'll be making all conference rooms <strong>read-only</strong> and redirecting discussion to <a href="https://matrix.to/#/#SeaGL:seattlematrix.org">#SeaGL:seattlematrix.org</a></li>
<li>If you’ve been using a temporary account (at <code>:seagl​.org</code>), you’ll need to <a href="https://seagl.org/meet">use another provider</a> to continue accessing Matrix.</li>
<li>All temporary accounts will be <strong>deleted</strong> on 2021-12-01.</li>
</ul>
</p>`;

  // Print list of rooms
//  for (const room of conferenceRooms) {
  for (const room of testRooms) {
    const roomId = room.roomId;
    
    try {
      await limiter.schedule(() =>
        client.sendHtmlNotice(roomId, messageText)
      );
      console.info("Message announced in: %j", {roomId});
    } catch (error: any) {
      throw error;
    }
  }
  console.info("Announcements made!");

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

