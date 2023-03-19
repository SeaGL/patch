import { getRequestFn, setRequestFn } from "matrix-bot-sdk";
import type _request from "request";

type RequestFn = typeof _request;

declare module "matrix-bot-sdk" {
  function getRequestFn(): RequestFn;

  function setRequestFn(request: RequestFn): void;
}
