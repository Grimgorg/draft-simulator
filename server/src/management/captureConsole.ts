import { captureConsole } from "./logBuffer.js";

// A module of its own so index.ts can import it first, ahead of the modules
// that log while they load (loadEnvFile.js reports the settings file there).
captureConsole(console);
