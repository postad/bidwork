import { task, logger } from "@trigger.dev/sdk";

// Connection check — run `npx trigger.dev@latest dev`, then this task appears in
// the dashboard and can be test-run. Replaced by the real engine tasks next.
export const helloWorld = task({
  id: "hello-world",
  maxDuration: 60,
  run: async (payload: { name?: string }) => {
    logger.info("BidWork × Trigger.dev is connected", { name: payload.name ?? "world" });
    return { ok: true, greeted: payload.name ?? "world" };
  },
});
