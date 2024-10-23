import type Client from "./Client.js";
import Module from "./Module.js";
import type { Define } from "../modules/Commands.js";
import type Patch from "../Patch.js";

export default abstract class extends Module {
  constructor(
    patch: Patch,
    matrix: Client,
    protected readonly on: Define,
  ) {
    super(patch, matrix);
  }
}
