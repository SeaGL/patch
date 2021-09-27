/* Missing from @types/matrix-js-sdk */
declare module "matrix-js-sdk" {
  export class AutoDiscovery {
    public static findClientConfig(domain: string): Promise<ClientWellKnown>;
  }

  export interface ClientWellKnown {
    "m.homeserver": {
      base_url: string;
    };
  }
}
