import { createExampleEnvFileIfMissing } from "./exampleEnvFile.js";
import { isPackaged, resolveEnvFilePath } from "./seaRuntime.js";

// The executable's stand-in for `npm start`'s --env-file-if-exists flag,
// which a packaged executable can't be launched with. index.ts imports this
// module first, because other modules read PORT and CARD_CACHE_MAX_AGE_DAYS
// as soon as they load. Real environment variables still win: loadEnvFile
// never overwrites one that's already set.
if (isPackaged) {
  const envFile = resolveEnvFilePath();
  try {
    if (createExampleEnvFileIfMissing(envFile)) {
      console.log(`Created ${envFile}. Edit it to change the port or set a lobby password.`);
    }
  } catch (err) {
    console.error(`Couldn't create the settings file ${envFile}; starting with the default settings.`, err);
  }
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`Couldn't read the settings file ${envFile}; starting with the default settings.`, err);
    }
  }
}
