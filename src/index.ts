import "dotenv/config";
import { getDb, migrate } from "./db/client.js";

async function main(): Promise<void> {
  const db = getDb();
  await migrate(db);
  console.log("harbormaster control plane started");
  // HTTP server / webhook handler will be added in a later milestone
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
