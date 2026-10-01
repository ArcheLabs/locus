import assert from "node:assert/strict";
import test from "node:test";
import { DeviceId, OlmMachine, RequestType, UserId, initAsync } from "@matrix-org/matrix-sdk-crypto-wasm";
import { MatrixCryptoDevice } from "../src/matrix/MatrixCryptoDevice.ts";

test("real SDK accepts externally cross-signed Locus devices without requiring local master verification", async () => {
  await initAsync();
  const userId = "@alice:example.org";
  const element = await OlmMachine.initialize(new UserId(userId), new DeviceId("ELEMENT"));
  const locus = await OlmMachine.initialize(new UserId(userId), new DeviceId("LOCUS"));
  const crypto = new MatrixCryptoDevice(locus, "LOCUS");
  const requests = [];
  const wrappers = [];
  try {
    const bootstrap = await element.bootstrapCrossSigning(true);
    wrappers.push(bootstrap);
    const signingUpload = bootstrap.uploadSigningKeysRequest;
    wrappers.push(signingUpload);
    const signing = JSON.parse(signingUpload.body);
    const outgoing = await locus.outgoingRequests();
    requests.push(...outgoing);
    const upload = outgoing.find((request) => request.type === RequestType.KeysUpload);
    assert.ok(upload);
    const deviceKeys = JSON.parse(upload.body).device_keys;
    const response = {
      master_keys: { [userId]: signing.master_key },
      self_signing_keys: { [userId]: signing.self_signing_key },
      user_signing_keys: { [userId]: signing.user_signing_key },
      device_keys: { [userId]: { LOCUS: deviceKeys } },
    };
    const apply = async (machine) => {
      const query = machine.queryKeysForUsers([new UserId(userId)]);
      try { await machine.markRequestAsSent(query.id, query.type, JSON.stringify(response)); }
      finally { query.free(); }
    };
    await apply(element);
    const externalDevice = await element.getDevice(new UserId(userId), new DeviceId("LOCUS"));
    assert.ok(externalDevice);
    wrappers.push(externalDevice);
    const signatures = await externalDevice.verify();
    wrappers.push(signatures);
    const signaturePatch = JSON.parse(signatures.body)[userId].LOCUS;
    const signedDevice = {
      ...deviceKeys,
      signatures: { ...deviceKeys.signatures, [userId]: { ...deviceKeys.signatures[userId], ...signaturePatch.signatures[userId] } },
    };
    response.device_keys[userId].LOCUS = signedDevice;
    await apply(locus);
    const identity = await locus.getIdentity(new UserId(userId));
    const device = await locus.getDevice(new UserId(userId), new DeviceId("LOCUS"));
    assert.ok(identity && device);
    wrappers.push(identity, device);
    assert.equal(JSON.parse(identity.masterKey).user_id, userId);
    assert.equal(identity.isVerified(), false);
    assert.equal(device.isCrossSigningTrusted(), false);
    assert.equal(await identity.trustsOurOwnDevice(), true);
    assert.equal(device.isCrossSignedByOwner(), true);

    const master = Buffer.from(Object.values(signing.master_key.keys)[0], "base64");
    const deviceKey = Buffer.from(deviceKeys.keys["ed25519:LOCUS"], "base64");
    crypto.setExpectedTrustKeys(master, deviceKey);
    // Isolate the post-sync trust adapter; browser sync transport is not under test.
    crypto.initialSyncComplete = true;
    const http = async () => JSON.stringify(response);
    assert.deepEqual(await crypto.refreshDeviceTrust(http), { state: "VERIFIED" });
    const signature = await crypto.sign(new TextEncoder().encode("JAMSCRIPT_ACTION_V2:test"));
    assert.equal(signature.length, 64, "the confirmed device can sign the existing controller action format");

    crypto.setExpectedTrustKeys(Buffer.alloc(32, 1), deviceKey);
    assert.equal((await crypto.refreshDeviceTrust(http)).state, "IDENTITY_CHANGED");
    crypto.setExpectedTrustKeys(master, Buffer.alloc(32, 1));
    assert.equal((await crypto.refreshDeviceTrust(http)).state, "DEVICE_REVOKED");
    crypto.setExpectedTrustKeys(master, deviceKey);
    response.device_keys[userId].LOCUS = deviceKeys;
    assert.equal((await crypto.refreshDeviceTrust(http)).state, "UNVERIFIED", "a local device key without the owner signature cannot pass");
    await assert.rejects(crypto.sign(new TextEncoder().encode("JAMSCRIPT_ACTION_V2:test")), { code: "DEVICE_NOT_VERIFIED" });
  } finally {
    for (const wrapper of [...wrappers, ...requests]) wrapper.free();
    assert.doesNotThrow(() => crypto.dispose());
    assert.doesNotThrow(() => crypto.dispose(), "cleanup is idempotent");
    element.close();
  }
});
