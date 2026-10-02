import assert from "node:assert/strict";
import test from "node:test";
import { bestHeadTransport, parseBestContext } from "../web/src/network/bestHeadTransport.ts";

const bestContext = {
  blockHash: `0x${"11".repeat(32)}`,
  blockNumber: 42,
  stateRoot: `0x${"22".repeat(32)}`,
  slot: 42,
  contextType: "best",
};

test("best-head adapter routes JamScript context reads to the best RPC", async () => {
  const calls = [];
  const transport = {
    async call(method, params) {
      calls.push({ method, params });
      return method === "minijam_getBestContext" ? bestContext : { ok: true };
    },
  };

  const adapted = bestHeadTransport(transport);
  assert.deepEqual(await adapted.call("minijam_getFinalizedContext"), bestContext);
  assert.deepEqual(calls, [{ method: "minijam_getBestContext", params: undefined }]);

  assert.deepEqual(await adapted.call("jamscript_getStateV1", { serviceId: 7 }), { ok: true });
  assert.deepEqual(calls[1], { method: "jamscript_getStateV1", params: { serviceId: 7 } });
});

test("best-head adapter rejects malformed or finalized responses without fallback", async () => {
  const adapted = bestHeadTransport({
    async call(method) {
      assert.equal(method, "minijam_getBestContext");
      return { ...bestContext, contextType: "finalized" };
    },
  });

  await assert.rejects(adapted.call("minijam_getFinalizedContext"), /invalid best context/);
  assert.throws(() => parseBestContext({ ...bestContext, slot: "42" }), /invalid best context/);
});
