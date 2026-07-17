// Small local smoke demo. Runtime DB stays ignored under .queuectl/.
import { execFileSync } from "node:child_process";
const cli = ["bin/queuectl.js"];
const run = (args) =>
  execFileSync(process.execPath, [...cli, ...args], { stdio: "inherit" });
run(["config", "set", "max-retries", "1"]);
run([
  "enqueue",
  '{"id":"hello-demo","command":"node -e \\"console.log(\\\'Hello QueueCTL\\\')\\"}',
]);
run(["enqueue", '{"id":"bad-demo","command":"node -e \\"process.exit(1)\\"}']);
run(["worker", "start", "--count", "2"]);
console.log("Workers launched. Run: node bin/queuectl.js status");
