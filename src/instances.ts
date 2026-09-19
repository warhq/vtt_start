export interface InstanceConfig {
  /** Stable identifier, used as the KV key suffix. */
  id: string;
  /** Display name shown on the status page. */
  name: string;
  /** Hostname of the Foundry VTT instance, without protocol. */
  host: string;
  /**
   * Optional manual override for the card image, used when the automatic
   * scrape of the instance's /join page can't find a background image
   * (e.g. a Foundry version with different markup, or a fully custom theme).
   */
  imageOverride?: string;
}

export const INSTANCES: InstanceConfig[] = [
  {
    id: "coc",
    name: "Call of Cthulhu",
    host: "coc-vtt.nixxon.se",
    // This instance hasn't been seen in "joinable" state since the image
    // cache went live, so auto-detection never got a chance to capture its
    // background. We know the real URL (confirmed from its /join page), so
    // seed it directly — Foundry serves world asset files even when the
    // world itself isn't launched. Safe to remove once the cache has
    // captured a real copy while this instance was green (then
    // auto-detection takes back over and follows future background
    // changes).
    imageOverride: "https://coc-vtt.nixxon.se/worlds/tgom/images/MoN%20Cover%201%20.jpg",
  },
  { id: "mgt2", name: "Mongoose Traveller 2e", host: "mgt2-vtt.nixxon.se" },
  { id: "pf2e", name: "Pathfinder 2e", host: "pf2e-vtt.nixxon.se" },
  { id: "dod", name: "Drakar och Demoner", host: "dod-vtt.nixxon.se" },
  { id: "t2k", name: "Twilight: 2000", host: "t2k-vtt.nixxon.se" },
];
