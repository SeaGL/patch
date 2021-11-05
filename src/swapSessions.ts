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
  const roomIdById = new Map();
  for (const roomId of joinedRoomIds) {
    const id = (await getCustomData(roomId))?.id;
    if (id !== undefined) {
      roomIdById.set(id, roomId);
    }
  }
  
  // Grab spaces
  const currentSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Current:${config.homeserver}`));
  const upcomingSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Upcoming:${config.homeserver}`));
  const completedSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Completed:${config.homeserver}`));

  // Specify lists of rooms
  const sessionRooms = [
//    {
//      id: "!room:seattlematrix.org",
//      session: "outgoing",
//    },
//    {
//      id: "!room:seattlematrix.org",
//      session: "outgoing",
//    },
//    {
//      id: "!room:seattlematrix.org",
//      session: "outgoing",
//    },
//    {
//      id: "!room:seattlematrix.org",
//      session: "incoming",
//    },
//    {
//      id: "!room:seattlematrix.org",
//      session: "incoming",
//    },
    {
      id: "!JCpsxuBhvplziTEClu:seattlematrix.org",
      session: "incoming",
    },
  ];

  // Move rooms to correct spaces
  for (const room of sessionRooms) {
    let oldSpace;
    let newSpace;
    
    const roomId = room.id;
    console.info("roomId: %j", {roomId});
    
    if (room.session === "outgoing") {
      oldSpace = currentSessionsSpace;
      newSpace = completedSessionsSpace;
    } else if (room.session === "incoming") {
      oldSpace = upcomingSessionsSpace;
      newSpace = currentSessionsSpace;
    } else {
      throw Error;
    }
    
    // Get roomName
    try {
      console.info("roomName: %j", await limiter.schedule(() =>
        client.getRoomStateEvent(roomId, "m.room.name", ""))
      );
    } catch (error: any) {
      if (error instanceof TypeError) {
        console.info("roomName not found");
      } else {
        throw error;
      }
    }

    // Add to new space
    try {
      await limiter.schedule(() =>
        newSpace.addChildRoom(roomId, {})
      );
    } catch (error: any) {
      throw error;
    }

    // Remove from current space
    try {
      await limiter.schedule(() => oldSpace.removeChildRoom(roomId));
    } catch (error: any) {
      throw error;
    }
    console.info("Room move successful.");
  }

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId });

})();

