import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev v4 config. `project` is the public ref (not a secret).
// Auth for `dev`/`deploy` comes from TRIGGER_SECRET_KEY (env) or `trigger.dev login`.
export default defineConfig({
  project: "proj_qocsicynsbseqemrissn",
  // Node 22 — supabase-js instantiates a Realtime client that needs a global
  // WebSocket; Node 21 (the "node" default) has none, so createClient throws.
  runtime: "node-22",
  logLevel: "info",
  // Generous ceiling — engine runs are minutes; big 100–200pp packages can run longer.
  maxDuration: 3600,
  dirs: ["./trigger"],
  build: {
    // Native addon (sharp) + wasm (mupdf) — don't bundle; install fresh in the deploy image.
    external: ["sharp", "mupdf"],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      randomize: true,
    },
  },
});
