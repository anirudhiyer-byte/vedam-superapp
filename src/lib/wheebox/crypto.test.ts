import { describe, it, expect } from "vitest";
import { wheeboxEncrypt, wheeboxDecrypt } from "./crypto";

// Known vector straight from the Wheebox API doc (login id used across its examples).
const KEY = "8nLNssE3VEyW";
const LOGIN = "john.carter@wheebox.com";
const CIPHER = "fe2761cbfa850a8ae7e1879b0c0c979bf650315fa83d23464a42652b20126fa1";

describe("wheebox crypto (AES-128-CBC, md5 key, fixed IV, PKCS7, hex)", () => {
  it("encrypts the doc's login-id vector exactly", () => {
    expect(wheeboxEncrypt(LOGIN, KEY)).toBe(CIPHER);
  });
  it("decrypts the doc's cipher back to the login id", () => {
    expect(wheeboxDecrypt(CIPHER, KEY)).toBe(LOGIN);
  });
  it("round-trips an arbitrary JSON payload", () => {
    const s = JSON.stringify({ loginId: LOGIN, firstName: "John", assignTests: [34074] });
    expect(wheeboxDecrypt(wheeboxEncrypt(s, KEY), KEY)).toBe(s);
  });
  it("round-trips unicode + punctuation", () => {
    const s = "VDM-UKAOT610 · नमस्ते · a@b.com";
    expect(wheeboxDecrypt(wheeboxEncrypt(s, KEY), KEY)).toBe(s);
  });
});
