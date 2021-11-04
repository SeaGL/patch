import { env } from "./utilities.js";

export const config = {
  homeserver: env("MATRIX_HOMESERVER"),
  accessToken: env("MATRIX_ACCESS_TOKEN"),
  conferenceServer: "seattlematrix.org",

  avatars: {
    seagl_logo_w_mic: "mxc://seattlematrix.org/OvtPvQJgPcFWLxDfBxHnFSiv",
    seagl_sticker_03: "mxc://seattlematrix.org/HdtuUcOVpqBKkjYnNWqLWYRx",
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
      "@wilco:seattlematrix.org": 50,
      "@harbinger:seattlematrix.org": 50,

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
      "@mateuskrause:matrix.org": 50,

      "@ex-nerd:matrix.org": 50,
      "@meonkeys:matrix.org": 50
    },
    "users_default": 0,
    "events": {
      "m.room.name": 50,
      "m.room.power_levels": 99,
      "m.room.history_visibility": 99,
      "m.room.canonical_alias": 50,
      "m.room.avatar": 50,
      "m.room.tombstone": 99,
      "m.room.server_acl": 99,
      "m.room.encryption": 99,
      "m.room.topic": 50,
      "im.vector.modular.widgets": 99
    },
    "events_default": 0,
    "state_default": 99,
    "ban": 50,
    "kick": 50,
    "redact": 50,
    "invite": 0,
    "historical": 99,
    "notifications": {
      "room": 50
    },
  },
};
