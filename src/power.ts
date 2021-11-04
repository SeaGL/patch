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
//  const roomIdById = new Map();
//  for (const roomId of joinedRoomIds) {
//    const id = (await getCustomData(roomId))?.id;
//    if (id !== undefined) {
//      roomIdById.set(id, roomId);
//    }
//  }
  
  // Specify lists of rooms
  const spacesSpec = [
    {
      id: "seagl2021-main",
      isPublic: true,
      localAlias: "SeaGL2021-Main",
    },
    {
      id: "seagl2021-sessions-current",
      isPublic: true,
      localAlias: "SeaGL2021-Sessions-Current",
      sortKey: "020",
    },
    {
      id: "seagl2021-information",
      isPublic: true,
      localAlias: "SeaGL2021-Information",
      sortKey: "030",
    },
    {
      id: "seagl2021-hallway",
      isPublic: true,
      localAlias: "SeaGL2021-Hallway",
      sortKey: "040",
    },
    {
      id: "seagl2021-restricted",
      isPublic: false,
      localAlias: "SeaGL2021-Restricted",
      sortKey: "100",
    },
    {
      id: "seagl2021-sessions-upcoming",
      isPublic: true,
      localAlias: "SeaGL2021-Sessions-Upcoming",
      sortKey: "200",
    },
    {
      id: "seagl2021-sessions-completed",
      isPublic: false,
      localAlias: "SeaGL2021-Sessions-Completed",
      sortKey: "300",
    },
  ];

  const getOsemRoomSpecs = async (slug) => {
    const url = `https://osem.seagl.org/api/v2/conferences/${slug}`;
    const response = (await (await fetch(url)).json()) as any;

    const records = new Map<string, any>();
    for (const record of response.included) {
      records.set(`${record.type}-${record.id}`, record);
    }

    return response.data.relationships.events.data.map(({ id, type }) => {
      const record = records.get(`${type}-${id}`);
      const beginning = DateTime.fromISO(record.attributes.beginning);

      return {
        id: `seagl2021-osem-${type}-${id}`,
        sortKey: "100",
        subspace: "sessions",
        roomType: "session",
      };
    });
  };
  
  const roomsSpec = [
    {
      id: "seagl2021-welcome",
      localAlias: "SeaGL2021-Welcome",
      sortKey: "010",
    },
    {
      id: "seagl2021-announcements",
      localAlias: "SeaGL2021-Announcements",
      sortKey: "011",
    },
    {
      id: "seagl2021-info-booth",
      localAlias: "SeaGL2021-Info-Booth",
      sortKey: "031",
      subspace: "information",
    },
    {
      id: "seagl2021-bot-help",
      localAlias: "SeaGL2021-Bot-Help",
      sortKey: "032",
      subspace: "information",
    },
    {
      id: "seagl2021-speaker-help",
      localAlias: "SeaGL2021-Speaker-Help",
      sortKey: "033",
      subspace: "information",
    },
    {
      id: "seagl2021-sponsor-help",
      localAlias: "SeaGL2021-Sponsor-Help",
      sortKey: "034",
      subspace: "information",
    },
    {
      id: "seagl2021-volunteering",
      localAlias: "SeaGL2021-Volunteering",
      sortKey: "035",
      subspace: "information",
    },
    {
      id: "seagl2021-social",
      localAlias: "SeaGL2021-Social",
      sortKey: "041",
      subspace: "hallway",
    },
    {
      id: "seagl2021-career-expo",
      localAlias: "SeaGL2021-Career-Expo",
      sortKey: "050",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsors",
      localAlias: "SeaGL2021-Sponsors",
      sortKey: "051",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-aws",
      localAlias: "SeaGL2021-Sponsor-AWS",
      sortKey: "052",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-jmp",
      localAlias: "SeaGL2021-Sponsor-JMP",
      sortKey: "053",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-google",
      localAlias: "SeaGL2021-Sponsor-Google",
      sortKey: "054",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-ubuntu",
      localAlias: "SeaGL2021-Sponsor-Ubuntu",
      sortKey: "055",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-red-hat",
      localAlias: "SeaGL2021-Sponsor-Red-Hat",
      sortKey: "056",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-tidelift",
      localAlias: "SeaGL2021-Sponsor-Tidelift",
      sortKey: "057",
      subspace: "hallway",
    },
    {
      id: "seagl2021-sponsor-extrahop",
      localAlias: "SeaGL2021-Sponsor-ExtraHop",
      sortKey: "058",
      subspace: "hallway",
    },
    {
      id: "seagl2021-orchestration",
      localAlias: "SeaGL2021-Orchestration",
      sortKey: "110",
      subspace: "restricted",
    },
    {
      id: "seagl2021-volunteers",
      localAlias: "SeaGL2021-Volunteers",
      sortKey: "120",
      subspace: "restricted",
    },
    {
      id: "seagl2021-career-expo-internal",
      localAlias: "SeaGL2021-Career-Expo-Internal",
      sortKey: "130",
      subspace: "restricted",
    },
    {
      id: "seagl-triage",
      localAlias: "SeaGL-Triage",
      sortKey: "140",
      subspace: "restricted",
    },
//    {
//      id: "seagl-tech",
//      localAlias: "SeaGL-Tech",
//      sortKey: "150",
//      subspace: "restricted",
//    },
//    {
//      id: "seagl-test",
//      localAlias: "SeaGL-Test",
//      sortKey: "160",
//      subspace: "restricted",
//    },
//    {
////      id: "seagl-staff",
//      localAlias: "SeaGL-Staff",
//      sortKey: "170",
//      subspace: "restricted",
//    },
    {
      id: "seagl-bot-log",
      localAlias: "SeaGL-Bot-Log",
      sortKey: "180",
      subspace: "restricted",
    },
//    ...(await getOsemRoomSpecs("seagl2021")),
  ];

  const testSpec = [
    {
      localAlias: "SeaGL2021-Sessions-Current",
    },
  ];

  const sessionRooms = [
    "!vWcDbxDwvPHXWyzNTy:seattlematrix.org",
    "!DdVJAoondbSwOGSofc:seattlematrix.org",
    "!SVmZdIiUaPfcQpMSJZ:seattlematrix.org",
    "!YkwOOVQDgmbQdJpBDn:seattlematrix.org",
//    "!KfDiePpsuSLAwIJjBi:seattlematrix.org",
    "!bLogtCGMRwfjibAjhf:seattlematrix.org",
    "!ftizaXTTZYpJLhnTVW:seattlematrix.org",
    "!pMNlExochDZkipVghs:seattlematrix.org",
    "!aKOqpocUqKIBhDNVpd:matrix.org",
//    "!zsCmqoFNSIlcwpCIuk:seattlematrix.org",
    "!TNwgVTOtLKtpsAwEBc:seattlematrix.org",
    "!WMkRrOCDMPNyclflNd:seattlematrix.org",
    "!elDQODQIaGtbuwjXjy:seattlematrix.org",
    "!OuIFWRhLzGYPOPfmSI:seattlematrix.org",
    "!CpIkgnZHSugBwwzywj:seattlematrix.org",
    "!uIzzOtYPhiHmvMQbuA:seattlematrix.org",
    "!sCCCJRWJhyMymODsVK:seattlematrix.org",
    "!uVdbWGkTYdAcoJHCTU:seattlematrix.org",
    "!fhbXydYAdHZjZLpkGY:seattlematrix.org",
    "!PBdleolqnzYxNWRwNe:seattlematrix.org",
    "!TeystpCkqtAgDuAzWE:seattlematrix.org",
    "!MbbNrygqBBpoXmPVoA:seattlematrix.org",
    "!sxFwNhoBcNrruydqOy:seattlematrix.org",
    "!ZNoHXmbhVYkHwGlzcH:seattlematrix.org",
    "!XXQofQouGXsmyxvtJF:seattlematrix.org",
    "!JCpsxuBhvplziTEClu:seattlematrix.org",
//    "!VkmwSHxGfbMNXUSseK:seattlematrix.org",
    "!VzpUWygJxRlMozUBBd:seattlematrix.org",
    "!zymbJqbtWzmhoDqPcC:seattlematrix.org",
    "!xmNJDpbBDGOVbDwFEe:seattlematrix.org",
    "!kDhvTKPIYYFSnVfGJl:seattlematrix.org",
    "!LNrEMNUyFRFhWdgZwx:seattlematrix.org",
    "!OaNCZgCPNpGSgCCKZC:seattlematrix.org",
    "!AqvlsQxtAcrOZRWAQt:seattlematrix.org",
    "!rqLJGesbIoXDENwPpq:seattlematrix.org",
    "!yuygpJsluDVcEkZUKz:seattlematrix.org",
    "!eUqnZpDuWntHtWFeNl:seattlematrix.org",
    "!dDJUMaohCrgNxAOBWa:seattlematrix.org",
//    "!NfmvinvjRxTLXKTsDe:seattlematrix.org",
    "!HsFBvfwMwCvcrwZVPp:seattlematrix.org",
    "!XnEdjjSKNAlaWPHkLb:seattlematrix.org",
    "!ZzgZvrYaSrxtqeNGca:seattlematrix.org",
    "!lmMWeNGbvifeRjRFTN:seattlematrix.org",
    "!YYTIJMHFAYTLQXnfgT:seattlematrix.org",
    "!UgGtJBRgMnMALCgrVY:seattlematrix.org",
    "!WfqoOcoLFEZQINvcZV:seattlematrix.org",
    "!WeheDPdQtknmyrBkFy:seattlematrix.org",
    "!aywyhLrUDHhjiHLJXb:seattlematrix.org",
    "!HZJomLZEPRtDCsGwcC:seattlematrix.org",
    "!TScCFMpNAZyQGUIeYL:seattlematrix.org"
  ]

//  for (const spec of roomsSpec) {
  for (const room of sessionRooms) {
    let roomId;
    
    // Get roomId
//    try {
//      if (spec.roomType === "session") {
//        roomId = roomIdById.get(spec.id);
//      } else {
//        roomId = await limiter.schedule(() =>
//          client.resolveRoom(`#${spec.localAlias}:${config.conferenceServer}`)
//        );
//      }
roomId = room;
      console.info("---");
      console.info("roomId: %j", roomId);
//    } catch (error: any) {
//      if (error.body?.errcode === "M_NOT_FOUND") {
//        continue;
//      }
//    }

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

    // Make sure that room is joined
    try {
      await limiter.schedule(() =>
        client.joinRoom(roomId)
      );
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND" && error.body?.errcode !== "M_UNKNOWN") {
        throw error;
      }
    }

    // Set defaultPowerLevels
    try {
      await limiter.schedule(() =>
        client.sendStateEvent(roomId, "m.room.power_levels", "", config.defaultPowerLevels)
      );
    } catch (error: any) {
      throw error;
    }
  }

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });

})();

