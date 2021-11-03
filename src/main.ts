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

const config = {
  homeserver: env("MATRIX_HOMESERVER"),
  accessToken: env("MATRIX_ACCESS_TOKEN"),

  avatars: {
    seagl_logo_w_mic: "mxc://sal.td/abNlvOvvkVvujQYlAHGCJQJu",
//    home: "mxc:kvalhe.im/cXGNnZfJTYtnTbGIUptUmCsm",
//    presentation: "mxc:kvalhe.im/JQhaLcmOzIYdRsQfWiqMCkFA",
//    seagl: "mxc:kvalhe.im/bmasxrBuggGXtMmcaudPmYAN",
//    videoStream: "mxc:kvalhe.im/sfRfgfLzEAVbnprJQYjbQRJm",
  },

  staffRoom: "!VkmwSHxGfbMNXUSseK:seattlematrix.org", // #SeaGL-staff:seattlematrix.org

  staffInvites: [
    "@salt:sal.td",
    "@salt:seattlematrix.org",
    "@Salt:matrix.org",

    "@andrew:kvalhe.im",
    "@sntxrr:seattlematrix.org",
    "@sntxrr:beeper.com",
    "@keithah:beeper.com",
    "@prasket:prasket.net",
    "@tree:seattlematrix.org",
//    "@haggeerrr:matrix.org",
//    "@romeo:seattlematrix.org",

//    "@lacey:seattlematrix.org",
//    "@dorian:threeraccoons.xyz",
//    "@f0nd004u:seattlematrix.org",
//    "@lucyv:matrix.org",

//    "@wholemilk:matrix.org",
//    "@nhandler:nhandler.com",

//    "@sri:gnome.org",
//    "@flox_advocate:matrix.org",
//    "@LuftHans:libera.chat",
//    "@xHans:libera.chat",
//    "@norm.norm:matrix.org",

//    "@eximious:matrix.org",

//    "@funnelfiasco:matrix.org",
//    "@mateus:matrix.org",

//    "@ex-nerd:matrix.org",
//    "@meonkeys:matrix.org",
//    "@wilco:seattlematrix.org",
  ],
  
  defaultPowerLevels: {
    "users": {
      "@seagl-bot:seattlematrix.org": 99,

      "@salt:sal.td": 100,
      "@salt:seattlematrix.org": 50,
      "@Salt:matrix.org": 50,

      "@andrew:kvalhe.im": 99,
      "@sntxrr:seattlematrix.org": 99,
      "@sntxrr:beeper.com": 99,
      "@keithah:beeper.com": 99,
      "@prasket:prasket.net": 99,
      "@tree:seattlematrix.org": 50,
      "@haggeerrr:matrix.org": 50,
      "@romeo:seattlematrix.org": 50,

      "@lacey:seattlematrix.org": 50,
      "@dorian:threeraccoons.xyz": 50,
      "@f0nd004u:seattlematrix.org": 50,
      "@lucyv:matrix.org": 50,

      "@wholemilk:matrix.org": 50,
      "@nhandler:nhandler.com": 50,

      "@sri:gnome.org": 50,
      "@flox_advocate:matrix.org": 50,
      "@LuftHans:libera.chat": 50,
      "@xHans:libera.chat": 50,
      "@norm.norm:matrix.org": 50,

      "@eximious:matrix.org": 50,

      "@funnelfiasco:matrix.org": 50,
      "@mateus:matrix.org": 50,

      "@ex-nerd:matrix.org": 50,
      "@meonkeys:matrix.org": 50,
      "@wilco:seattlematrix.org": 50,
    },
    "users_default": 0,
    "events": {
      "m.room.name": 50,
      "m.room.power_levels": 99,
      "m.room.history_visibility": 99,
      "m.room.canonical_alias": 50,
      "m.room.avatar": 50,
      "m.room.tombstone": 100,
      "m.room.server_acl": 100,
      "m.room.encryption": 100,
      "m.room.topic": 50,
      "im.vector.modular.widgets": 99,
    },
    "events_default": 0,
    "state_default": 99,
    "ban": 50,
    "kick": 50,
    "redact": 50,
    "invite": 0,
    "historical": 99,
    "notifications": {
      "room": 50,
    },
  },
};

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
  let createdSpaces = false;
  let space;
  let mainSpace;
  let currentSessionsSpace;
  let hallwaySpace;
  let informationSpace;
  let upcomingSessionsSpace;
  let completedSessionsSpace;
  let restrictedSpace;
  const variables: Record<string, string> = {};

  // Find or create space
  const spacesSpec = [
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-main",
      isPublic: true,
      localAlias: "SeaGL2021-Main",
      name: "SeaGL 2021",
      suggested: true,
      topic: "Welcome to the #SeaGL2021 Space! Here you'll find a variety of conference rooms. Please look around, introduce yourself in #SeaGL2021-welcome , and ask any questions! | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sessions-current",
      isPublic: true,
      localAlias: "SeaGL2021-Sessions-Current",
      name: "Current Sessions | #SeaGL2021",
      sortKey: "020",
      suggested: true,
      topic: "Here you can find the sessions that are currently taking place. | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-information",
      isPublic: true,
      localAlias: "SeaGL2021-Information",
      name: "Information | #SeaGL2021",
      sortKey: "030",
      suggested: true,
      topic: "Have a question? One of these rooms will have your answer! Info rooms for speakers, sponsers, attendees, etc. | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-hallway",
      isPublic: true,
      localAlias: "SeaGL2021-Hallway",
      name: "Hallway | #SeaGL2021",
      sortKey: "040",
      suggested: true,
      topic: "Here is where all of the \"hallway track\" (off-topic/social, sponsor, etc.) conversations take place. | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-restricted",
      isPublic: false,
      localAlias: "SeaGL2021-Restricted",
      name: "Restricted | #SeaGL2021",
      sortKey: "100",
      suggested: false,
      topic: "These rooms are only available to SeaGL 2021 staff and volunteers. Inviting someone to this space will allow them to join some of the rooms within.",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sessions-upcoming",
      isPublic: true,
      localAlias: "SeaGL2021-Sessions-Upcoming",
      name: "Upcoming Sessions | #SeaGL2021",
      sortKey: "200",
      suggested: false,
      topic: "Here are all of the sessions which have not yet happened. Join ahead of time and chat with other interested attendees! | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sessions-completed",
      isPublic: false,
      localAlias: "SeaGL2021-Sessions-Completed",
      name: "Completed Sessions | #SeaGL2021",
      sortKey: "300",
      suggested: false,
      topic: "These sessions have been wrapped up! | Recordings, from this year and past, will be available on https://archive.org/details/seagl after the event.",
    },
  ];
  for (const spec of spacesSpec) {
    const spaceAlias = `#${spec.localAlias}:${config.homeserver}`;
    try {
      space = await limiter.schedule(() => client.getSpace(spaceAlias));
      console.info("🏘️ Space exists: %j", {
        alias: spaceAlias,
        roomId: space.roomId,
      });
    } catch (error: any) {
      if (error.body?.errcode !== "M_NOT_FOUND") {
        throw error;
      }

      if (spec.id === "seagl2021-main") {
        space = await limiter.schedule(() =>
          client.createSpace({
            avatarUrl: spec.avatar,
            invites: config.staffInvites,
            isPublic: spec.isPublic,
            localpart: spec.localAlias,
            name: spec.name,
  //          room_version: "9",
            topic: spec.topic,
          })
        );
        mainSpace = space;
      } else {
        space = await limiter.schedule(() =>
          mainSpace.createChildSpace({
            avatarUrl: spec.avatar,
            invites: config.staffInvites,
            isPublic: spec.isPublic,
            localpart: spec.localAlias,
            name: spec.name,
  //          room_version: "9",
            topic: spec.topic,
          })
        );
      }
      // set default space power_levels
      const currentLevels = await limiter.schedule(() =>
        client.getRoomStateEvent(space.roomId, "m.room.power_levels", "")
      );
      console.info("🔋 Intial space power levels: %j", 
        currentLevels
      );
//      currentLevels['users'] = config.staff_power;
//      await limiter.schedule(() =>
//        client.sendStateEvent(space.roomId, "m.room.power_levels", "", currentLevels)
//      );
      await limiter.schedule(() =>
        client.sendStateEvent(space.roomId, "m.room.power_levels", "", config.defaultPowerLevels)
      );
      joinedRoomIds.add(space.roomId);
      console.info("🏘️ Created space: %j", {
        roomId: space.roomId,
        spec: spec,
      });
    }
  }

  mainSpace = await limiter.schedule(() => client.getSpace(`#SeaGL2021-Main:${config.homeserver}`));
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

  createdSpaces = true;

  // Find or create rooms
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
        avatar: config.avatars.seagl_logo_w_mic,
        id: `seagl2021-osem-${type}-${id}`,
        name: `${beginning.toFormat("EEE HH:mm")} - ${record.attributes.title}`,
        sortKey: "200",
        subspace: "sessions",
        topic: "#SeaGL2021 Conference Session | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
        welcome:
          "Squawk! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This room is dedicated to a single conference session. See {mainSpace} for a listing of all rooms.",
        widget: true,
      };
    });
  };
  const roomsSpec = [
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-welcome",
      localAlias: "SeaGL2021-Welcome",
      name: "Welcome | #SeaGL2021",
      sortKey: "010",
      suggested: true,
      topic: "This is the central room for introductions and orientation. Please join the sessions you are interested in attending and #SeaGL2021-Social for general discussion. | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for introductions and orientation. See {mainSpace} for a listing of all conference rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-announcements",
      localAlias: "SeaGL2021-Announcements",
      name: "Announcements | #SeaGL2021",
      sortKey: "011",
      suggested: true,
      topic: "The place to be for timely conference updates and announcements.",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. Important information such as scheduling announcements will be posted here. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-info-booth",
      localAlias: "SeaGL2021-Info-Booth",
      name: "Info Booth | #SeaGL2021",
      sortKey: "031",
      subspace: "information",
      suggested: true,
      topic: "Have a question? Not sure where to look? We'll point you in the right direction!",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to ask questions and get help with any conference related topics. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-bot-help",
      localAlias: "SeaGL2021-Bot-Help",
      name: "Bot Help | #SeaGL2021",
      sortKey: "032",
      subspace: "information",
      suggested: true,
      topic: "Information about and help for Patch, the SeaGL seagull bot.",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to ask questions and get help about intereacting with me! See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-speaker-help",
      localAlias: "SeaGL2021-Speaker-Help",
      name: "Speaker Help | #SeaGL2021",
      sortKey: "033",
      subspace: "information",
      suggested: false,
      topic: "Need help with your talk? Have a question about your session? We're here to help!",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room for speakers to ask questions and get help. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-help",
      localAlias: "SeaGL2021-Sponsor-Help",
      name: "Sponsor Help | #SeaGL2021",
      sortKey: "034",
      subspace: "information",
      suggested: false,
      topic: "Are you a sponsor in need of assistance? Thank You! How can we help?",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room for sponsors to ask questions and get help. See {mainSpace} for a listing of all rooms.",
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-volunteering",
      localAlias: "SeaGL2021-Volunteering",
      name: "Volunteering | #SeaGL2021",
      sortKey: "035",
      subspace: "information",
      suggested: false,
      topic: "Do you want to volunteer to help with SeaGL? Let us know! FInd out more on the SeaGL site: https:seagl.org/get_involved.html or join our volunteer communications by sending a quick email to participate@seagl.org",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to learn more about lending a wing or beak in service of this all-volunteer staffed conference. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-social",
      localAlias: "SeaGL2021-Social",
      name: "Social | #SeaGL2021",
      sortKey: "041",
      subspace: "hallway",
      suggested: true,
      topic: "A place to socialize and chat with other attendees about whatever. Social events such as TeaGL and the evening parties will take place here. | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for \"hallway track\" socializing. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-career-expo",
      localAlias: "SeaGL2021-Career-Expo",
      name: "Career Expo | #SeaGL2021",
      sortKey: "050",
      subspace: "hallway",
      suggested: false,
      topic: "Looking for work? Looking to hire? Looking for help with your resume? Let us know! | Please note, the SeaGL Code of Conduct is in effect and can be found here: https://seagl.org/coc | The Career Expo is presented by RaiseMe",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for participating in the Career Expo. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsors",
      localAlias: "SeaGL2021-Sponsors",
      name: "Sponsors | #SeaGL2021",
      sortKey: "051",
      subspace: "hallway",
      suggested: true,
      topic: "Come meet the wonderful folks who make this conference possible! | Please note, the SeaGL Code of Conduct is in effect and can be found here: https:seagl.org/coc",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for meeting our generous sponsors. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-aws",
      localAlias: "SeaGL2021-Sponsor-AWS",
      name: "AWS Booth | #SeaGL2021",
      sortKey: "052",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, Amazon Web Services",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to speak with representatives from our sponsor Amazon Web Services. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-jmp",
      localAlias: "SeaGL2021-Sponsor-JMP",
      name: "JMP.chat Booth | #SeaGL2021",
      sortKey: "053",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, JMP.chat",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to speak with representatives from our sponsor JMP.chat. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-google",
      localAlias: "SeaGL2021-Sponsor-Google",
      name: "Google Booth | #SeaGL2021",
      sortKey: "054",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, Google",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to speak with representatives from our sponsor Google. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-ubuntu",
      localAlias: "SeaGL2021-Sponsor-Ubuntu",
      name: "Ubuntu Booth | #SeaGL2021",
      sortKey: "055",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, the Ubuntu Community Fund",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room dedicated to the Ubuntu Community Fund. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-red-hat",
      localAlias: "SeaGL2021-Sponsor-Red-Hat",
      name: "Red Hat Booth | #SeaGL2021",
      sortKey: "056",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, Red Hat",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to speak with representatives from our sponsor, Red Hat. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-tidelift",
      localAlias: "SeaGL2021-Sponsor-Tidelift",
      name: "Tidelift Booth | #SeaGL2021",
      sortKey: "057",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, Tidelift",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to speak with representatives from our sponsor, Tidelift. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-sponsor-extrahop",
      localAlias: "SeaGL2021-Sponsor-ExtraHop",
      name: "ExtraHop Booth | #SeaGL2021",
      sortKey: "058",
      subspace: "hallway",
      suggested: false,
      topic: "Come speak to representatives from our sponsor, ExtraHop",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room to speak with representatives from our sponsor, ExtraHop. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-orchestration",
      localAlias: "SeaGL2021-Orchestration",
      name: "Orchestration | #SeaGL2021",
      sortKey: "110",
      subspace: "restricted",
      suggested: false,
      topic: "Ready your batons! This is the SeaGL 2021 control-center.",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is a central room for orchestrating the conference. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-volunteers",
      localAlias: "SeaGL2021-Volunteers",
      name: "Volunteers | #SeaGL2021",
      sortKey: "120",
      subspace: "restricted",
      suggested: false,
      topic: "This is the operational room for all SeaGL 2021 volunteers. Please join this room if you are volunteering with SeaGL 2021.",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the room for coordinating all of the SeaGL 2021 volunteers. See {mainSpace} for a listing of all rooms.",
      widget: true,
    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl2021-career-expo-internal",
      localAlias: "SeaGL2021-Career-Expo-Internal",
      name: "Career Expo Internal | #SeaGL2021",
      sortKey: "130",
      subspace: "restricted",
      suggested: false,
      topic: "This is the operational room for the SeaGL 2021 Career Expo.",
      welcome:
        "Welcome to SeaGL 2021! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. This is the operational room for the Career Expo. See {mainSpace} for a listing of all rooms.",
    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-triage",
//      localAlias: "SeaGL-Triage",
//      name: "SeaGL Triage",
//      sortKey: "140",
//      subspace: "restricted",
//      suggested: false,
//      topic: "Operational room for SeaGL Code of Conduct moderation and triage.",
//      welcome: "Please take a moment to go over the SeaGL Code of Conduct https://seagl.org/code_of_conduct and confirm you feel confident in your ability to moderate accordingly by adding an affirmative reaction to this message.",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-tech",
//      localAlias: "SeaGL-Tech",
//      name: "SeaGL Tech",
//      sortKey: "150",
//      subspace: "restricted",
//      suggested: false,
//      topic: "Central hub for the technical operation of SeaGL.",
//      welcome: "SLEEP IS FOR THE WEAK. SLEEP IS FOR NEXT WEEK!",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-test",
//      localAlias: "SeaGL-Test",
//      name: "SeaGL Test",
//      sortKey: "160",
//      subspace: "restricted",
//      suggested: false,
//      topic: "SeaGL Testing Room",
//      welcome: "testing... 1... 2... 3...",
//    },
//    {
//      avatar: config.avatars.seagl_logo_w_mic,
//      id: "seagl-staff",
//      localAlias: "SeaGL-Staff",
//      name: "SeaGL Staff",
//      sortKey: "170",
//      subspace: "restricted",
//      suggested: false,
//      topic: "Birdhouse dedicated to the SeaGL staff.",
//      welcome:
//          "Squawk! I’m <strong>Patch</strong> (they/them), the SeaGL mascot. We are going to put on an amazing show! See {mainSpace} for a listing of all rooms.",
//    },
    {
      avatar: config.avatars.seagl_logo_w_mic,
      id: "seagl-bot-log",
      localAlias: "SeaGL-Bot-Log",
      name: "SeaGL Bot Log",
      sortKey: "180",
      subspace: "restricted",
      suggested: false,
      topic: "SeaGL Bot Log",
      welcome:
          "Squawk!",
    },
    ...(await getOsemRoomSpecs("seagl2021")),
  ];
  for (const spec of roomsSpec) {
    let roomId = roomIdById.get(spec.id);
    if (roomId === undefined) {
      const widgetStateKey = `🪶${spec.id}`;
      const widgetEvents = spec.widget
        ? [
            {
              type: "im.vector.modular.widgets",
              state_key: widgetStateKey,
              content: {
                type: "customwidget",
                creatorUserId: userId,
                name: "SeaGL 2021",
                avatar_url: config.avatars.seagl_logo_w_mic,
                url: "https://attend.seagl.org/widgets/index.html",
              },
            },
            {
              type: "io.element.widgets.layout",
              state_key: "",
              content: {
                widgets: {
                  [widgetStateKey]: {
                    container: "top",
                    height: 25,
                    width: 100,
                    index: 0,
                  },
                },
              },
            },
          ]
        : [];

      if (spec.subspace === "restricted") {
        roomId = await limiter.schedule(() =>
          client.createRoom({
            initial_state: [
              {
                type: "m.room.avatar",
                state_key: "",
                content: { url: spec.avatar },
              },
              {
                type: "m.room.guest_access",
                state_key: "",
                content: { guest_access: "can_join" },
              },
              {
                type: "m.room.history_visibility",
                state_key: "",
                content: { history_visibility: "world_readable" },
              },
              {
                type: "m.room.join_rules",
                state_key: "",
                content: {
                  "join_rule": "restricted",
                  "allow": [{
                    "type": "m.room_membership",
                    "room_id": restrictedSpace.roomId,
                  }],
                },
              },
              {
                type: "org.seagl.2021roomgenerator",
                state_key: "",
                content: { id: spec.id },
              },
             ...widgetEvents,
            ],
            name: spec.name,
            power_level_content_override: config.defaultPowerLevels,
  //            preset: "private_chat",
            room_alias_name: spec.localAlias,
            room_version: "9",
            topic: spec.topic,
            visibility: "private",
          })
        );
      } else {
        roomId = await limiter.schedule(() =>
          client.createRoom({
            initial_state: [
              {
                type: "m.room.avatar",
                state_key: "",
                content: { url: spec.avatar },
              },
              {
                type: "m.room.guest_access",
                state_key: "",
                content: { guest_access: "can_join" },
              },
              {
                type: "m.room.history_visibility",
                state_key: "",
                content: { history_visibility: "world_readable" },
              },
              {
                type: "org.seagl.2021roomgenerator",
                state_key: "",
                content: { id: spec.id },
              },
              ...widgetEvents,
            ],
            name: spec.name,
            power_level_content_override: config.defaultPowerLevels,
            preset: "public_chat",
            room_alias_name: spec.localAlias,
            room_version: "9",
            topic: spec.topic,
            visibility: "public",
          })
        );
      }
      roomIdById.set(spec.id, roomId);
      joinedRoomIds.add(roomId);
      console.info("🏠 Created room: %j", { roomId, spec });
      if (spec.subspace === undefined) {
        await limiter.schedule(() =>
          mainSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      await limiter.schedule(() =>
        client.sendHtmlNotice(
          roomId,
          spec.welcome.replaceAll(/{(\w+)}/g, (_, name) => variables[name])
        )
      );
    } else {
      console.info("🏠 Room exists: %j", { id: spec.id, roomId });
    }
  }

  // Add rooms to correct subspaces
  for (const spec of roomsSpec) {
    let roomId = roomIdById.get(spec.id);
    if (roomId !== undefined) {
      if (spec.subspace === "hallway") {
        await limiter.schedule(() =>
          hallwaySpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      if (spec.subspace === "information") {
        await limiter.schedule(() =>
          informationSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      if (spec.subspace === "sessions") {
        await limiter.schedule(() =>
          upcomingSessionsSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
      if (spec.subspace === "restricted") {
        await limiter.schedule(() =>
          restrictedSpace.addChildRoom(roomId, {
            order: spec.sortKey,
            suggested: spec.suggested,
          })
        );
      }
    } else {
      console.info("🏠 Room has not yet been created: %j", { id: spec.id });
    }
  }
  
//  // Handle invitations
//  client.on("room.invite", async (roomId, event) => {
//    if (roomId === config.staffRoom) {
//      console.info("💌 Accepting invitation: %j", { roomId, event });
//      await limiter.schedule(() => client.joinRoom(roomId));
//      await limiter.schedule(() =>
//        client.sendHtmlNotice(
//          roomId,
//          "Squawk! I’m <strong>Patch</strong> (they/them), the SeaGL mascot."
//        )
//      );

//      if (space !== undefined) {
//        await limiter.schedule(() =>
//          space.addChildRoom(roomId, { order: "800" })
//        );
//        await limiter.schedule(() =>
//          client.sendHtmlNotice(roomId, `Come join me in ${variables.mainSpace}!`)
//        );
//      }
//    } else {
//      console.warn("🗑️ Rejecting invitation: %j", { roomId, event });
//      await limiter.schedule(() => client.leaveRoom(roomId));
//    }
//  });

//  // Handle kicks
//  client.on("room.leave", async (roomId, event) => {
//    if (event.sender !== userId) {
//      console.warn("👮 Got kicked: %j", { roomId, event });
//    }
//  });

//  // Handle staff commands
//  client.on("room.message", async (roomId, event) => {
//    if (
//      !(
//        event?.content?.msgtype === "m.text" &&
//        event.sender !== userId &&
//        event?.content?.body?.startsWith("!")
//      )
//    ) {
//      return;
//    }

//    if (!(roomId === config.staffRoom && event?.content?.body === "!hello")) {
//      console.warn("⚠️ Ignoring command: %j", { roomId, event });
//      return;
//    }

//    const text = "Hello World!";
//    const content = RichReply.createFor(roomId, event, text, text);
//    content.msgtype = "m.notice";

//    await limiter.schedule(() => client.sendMessage(roomId, content));
//  });

  // Start
  await client.start();
  console.info("🟢 Ready: %j", { userId, joinedRoomIds });
  if (createdSpaces) {
    await limiter.schedule(() =>
      client.sendHtmlNotice(
        roomIdById.get("seagl2021-orchestration"),
        `Come join me in ${variables.mainSpace}!`
      )
    );
  }
  if (createdSpaces && joinedRoomIds.has(config.staffRoom)) {
    await limiter.schedule(() =>
      client.sendHtmlNotice(
        config.staffRoom,
        `Come join me in ${variables.mainSpace}!`
      )
    );
  }
})();
