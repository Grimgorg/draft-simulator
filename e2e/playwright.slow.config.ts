import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";

/**
 * The normal browser tests, slowed down in visible browser windows so a person can watch the draft play out.
 * A whole draft takes about 2s at full speed, too fast to follow even in UI mode.
 */
export default defineConfig({
  ...baseConfig,
  // One test at a time, or the two tests' host and guest windows pile up on top of each other.
  workers: 1,
  // At slowMo 500 the full-draft test takes about 10s; this leaves room to slow it further without timing out.
  timeout: 120_000,
  use: {
    ...baseConfig.use,
    headless: false,
    launchOptions: { slowMo: 500 },
  },
});
