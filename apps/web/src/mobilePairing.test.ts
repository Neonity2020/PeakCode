import { describe, expect, it } from "vitest";

import { pairingCredentialFrom, pairingTargetFrom } from "./mobilePairing";

describe("pairingCredentialFrom", () => {
  it("reads the credential out of a /pair hand-off link", () => {
    expect(pairingCredentialFrom("http://192.168.1.42:3773/pair#token=PAIR123")).toBe("PAIR123");
    expect(pairingCredentialFrom("http://192.168.1.42:3773/pair/#token=PAIR123")).toBe("PAIR123");
  });

  it("reads it on the phone page too, which is where the QR code now points", () => {
    expect(pairingCredentialFrom("https://words.trycloudflare.com/h5#token=PAIR123")).toBe(
      "PAIR123",
    );
    expect(pairingCredentialFrom("https://words.trycloudflare.com/h5/#token=PAIR123")).toBe(
      "PAIR123",
    );
    expect(pairingCredentialFrom("http://localhost:5733/mobile.html#token=PAIR123")).toBe(
      "PAIR123",
    );
  });

  it("ignores every other path, so a normal visit never posts a credential", () => {
    expect(pairingCredentialFrom("http://localhost:3773/#token=PAIR123")).toBeNull();
    expect(pairingCredentialFrom("http://localhost:3773/settings")).toBeNull();
    expect(pairingCredentialFrom("http://localhost:3773/h5something")).toBeNull();
    expect(pairingCredentialFrom("not a url")).toBeNull();
  });

  it("ignores a /pair visit without a credential", () => {
    expect(pairingCredentialFrom("http://localhost:3773/pair")).toBeNull();
    expect(pairingCredentialFrom("http://localhost:3773/pair#token=")).toBeNull();
  });
});

describe("pairingTargetFrom", () => {
  it("reads the conversation the desktop handed over", () => {
    expect(
      pairingTargetFrom(
        "https://words.trycloudflare.com/pair#token=PAIR123&thread=thread-1&project=project-9",
      ),
    ).toEqual({ threadId: "thread-1", projectId: "project-9" });
  });

  it("keeps a project that has no thread yet, and reports what is simply absent", () => {
    expect(pairingTargetFrom("/pair#token=PAIR123&project=project-9")).toEqual({
      threadId: null,
      projectId: "project-9",
    });
    expect(pairingTargetFrom("/pair#token=PAIR123")).toEqual({ threadId: null, projectId: null });
    expect(pairingTargetFrom("/pair#token=PAIR123&thread=&project=")).toEqual({
      threadId: null,
      projectId: null,
    });
  });

  it("carries nothing for a visit that is not a hand-off", () => {
    expect(pairingTargetFrom("http://localhost:3773/thread-1")).toEqual({
      threadId: null,
      projectId: null,
    });
  });

  it("reads the conversation off the phone page, which is where the link lands", () => {
    expect(pairingTargetFrom("/h5#token=PAIR123&thread=thread-1&project=project-9")).toEqual({
      threadId: "thread-1",
      projectId: "project-9",
    });
  });
});
