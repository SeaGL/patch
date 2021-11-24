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

  // State
  let mainSpace;
  let currentSessionsSpace;
  let hallwaySpace;
  let informationSpace;
  let upcomingSessionsSpace;
  let completedSessionsSpace;
  let restrictedSpace;
  const variables: Record<string, string> = {};

  mainSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021:${config.homeserver}`));
  currentSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Current:${config.homeserver}`));
  hallwaySpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Hallway:${config.homeserver}`));
  informationSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Information:${config.homeserver}`));
  restrictedSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Restricted:${config.homeserver}`));
  upcomingSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Upcoming:${config.homeserver}`));
  completedSessionsSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Sessions-Completed:${config.homeserver}`));

  variables.mainSpace = (await MentionPill.forRoom(mainSpace.roomId, client)).html;
  variables.currentSessionsSpace = (await MentionPill.forRoom(currentSessionsSpace.roomId, client)).html;
  variables.hallwaySpace = (await MentionPill.forRoom(hallwaySpace.roomId, client)).html;
  variables.informationSpace = (await MentionPill.forRoom(informationSpace.roomId, client)).html;
  variables.restrictedSpace = (await MentionPill.forRoom(restrictedSpace.roomId, client)).html;
  variables.upcomingSessionsSpace = (await MentionPill.forRoom(upcomingSessionsSpace.roomId, client)).html;
  variables.completedSessionsSpace = (await MentionPill.forRoom(completedSessionsSpace.roomId, client)).html;
  
  let mainRooms;
  let informationRooms;
  let hallwayRooms;
  let restrictedRooms;
  let completedSessionRooms;

  mainRooms = {
    "!uGiaRBQRDGlglSGtfI:seattlematrix.org": "Welcome",
    "!WnTDIdHtxjakDrrXWg:seattlematrix.org": "Announcements"
  };
  informationRooms = await limiter.schedule(() => informationSpace.getChildEntities());
  hallwayRooms = await limiter.schedule(() => hallwaySpace.getChildEntities());
  restrictedRooms = {
    "!MvTiWLbdOAHJxcxFWj:seattlematrix.org": "Orchestration",
    "!VOlgfOQQBXirZEkuAx:seattlematrix.org": "Volunteers",
    "!lFSJlgZmxAwmaeAifp:seattlematrix.org": "Career Expo Internal"
  }
  completedSessionRooms = await limiter.schedule(() => completedSessionsSpace.getChildEntities());

  let roomsToTombstone;
//  roomsToTombstone = [mainRooms, informationRooms, hallwayRooms, restrictedRooms, completedSessionRooms];
//  roomsToTombstone = [informationRooms, hallwayRooms, completedSessionRooms];
//  roomsToTombstone = [informationRooms, completedSessionRooms];
//  roomsToTombstone = [hallwayRooms];
  roomsToTombstone = [mainRooms, restrictedRooms];

  const messageText = `<p>Thank you for an amazing SeaGL 2021!</p>
<p>Please join us in our year-round community space at <a href="https://matrix.to/#/#SeaGL:seattlematrix.org">#SeaGL:seattlematrix.org</a>.</p>
<p>To wrap up the conference:<br>
<ul>
<li>We'll be making all conference rooms <strong>read-only</strong> and redirecting discussion to <a href="https://matrix.to/#/#SeaGL:seattlematrix.org">#SeaGL:seattlematrix.org</a></li>
<li>If you’ve been using a temporary account (at <code>:seagl​.org</code>), you’ll need to <a href="https://seagl.org/meet">use another provider</a> to continue accessing Matrix.</li>
<li>All temporary accounts will be <strong>deleted</strong> on 2021-12-01.</li>
</ul>
</p>`;
  
  const tombstoneEvent = {
    "body": "All SeaGL 2021 rooms have been made read-only. Please join our year-round community space: #SeaGL:seattlematrix.org",
    "replacement_room": "!fHutkXSXrHfkdyIiRX:seattlematrix.org"
  }

  // Send message and tombstone all conference rooms
  for (const tombSpace of roomsToTombstone) {
    Object.keys(tombSpace).forEach(async (room) => {
      const roomId = room;
      
      try {
        await limiter.schedule(() =>
          client.sendHtmlNotice(roomId, messageText)
        );
        console.info("Message announced in: %j", {roomId});
        try {
          await limiter.schedule(() =>
            client.sendStateEvent(roomId, "m.room.tombstone", "", tombstoneEvent)
          );
          console.info("Tombstone set in: %j", {roomId});
        } catch (error: any) {
          console.info("Tombstone error in: %j", {roomId})
          if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_FORBIDDEN") {
            throw error;
          }
        }
      } catch (error: any) {
        console.info("Message error in: %j", {roomId})
        if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_FORBIDDEN") {
          throw error;
        }
      }

    });
  }
  console.info("Announcements made and Tombstones set for all rooms!");

  let spacesToTombstone = [
    currentSessionsSpace,
    hallwaySpace,
    informationSpace,
    upcomingSessionsSpace,
    completedSessionsSpace,
    restrictedSpace,
    mainSpace
  ];

  // Tombstone all conference spaces
  for (const space of spacesToTombstone) {
    const spaceId = space.roomId;
    
    try {
      await limiter.schedule(() =>
        client.sendStateEvent(spaceId, "m.room.tombstone", "", tombstoneEvent)
      );
      console.info("Tombstone set in: %j", {spaceId});
    } catch (error: any) {
      console.info("Tombstone error in: %j", {spaceId})
      if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_FORBIDDEN") {
        throw error;
      }
    }
  }
  console.info("Tombstones set for all spaces!");

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

