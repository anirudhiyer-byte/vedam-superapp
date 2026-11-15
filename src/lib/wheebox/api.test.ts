import { describe, it, expect } from "vitest";
import { wheeboxDecrypt } from "./crypto";
import { buildAssignUrl, buildTestLinkUrl, buildAuthenticateUrl, buildResultUrl, buildRegisterUrl, toWheeboxDate, type Creds } from "./api";

// doc creds + the known login-id cipher (matches the assignTest/testlink URL examples)
const C: Creds = { base: "https://uat.wheebox.com", companyCode: "0275000", accessToken: "8nLNssE3VEyW", privateKey: "8nLNssE3VEyW" };
const LOGIN = "john.carter@wheebox.com";
const LOGIN_CIPHER = "fe2761cbfa850a8ae7e1879b0c0c979bf650315fa83d23464a42652b20126fa1";

const valOf = (url: string) => decodeURIComponent(url.split("?val=")[1]);

describe("wheebox api url builders", () => {
  it("assignTest: encrypted loginId segment matches the doc vector + val round-trips", () => {
    const assignments = { "113173": { startDate: "2022-08-02 11:00:01", endDate: "2022-08-03 11:00:01" } };
    const url = buildAssignUrl(C, LOGIN, assignments);
    expect(url.startsWith(`https://uat.wheebox.com/wheeboxAPI_v2/assignTest/0275000/${LOGIN_CIPHER}?val=`)).toBe(true);
    expect(JSON.parse(wheeboxDecrypt(valOf(url), C.privateKey))).toEqual(assignments);
  });

  it("testlink: path is /testlink/{cc}/{encTestNo}/{encLoginId}/{encOsr}", () => {
    const url = buildTestLinkUrl(C, "34074", LOGIN, "o");
    const parts = url.replace("https://uat.wheebox.com/wheeboxAPI_v2/testlink/", "").split("/");
    expect(parts[0]).toBe("0275000");
    expect(wheeboxDecrypt(parts[1], C.privateKey)).toBe("34074");
    expect(parts[2]).toBe(LOGIN_CIPHER);
    expect(wheeboxDecrypt(parts[3], C.privateKey)).toBe("o");
  });

  it("authenticate: encrypted loginId + plain token", () => {
    const url = buildAuthenticateUrl(C, LOGIN, "wheebox_dummy_token");
    expect(url).toBe(`https://uat.wheebox.com/wheeboxAPI_v2/authenticate/0275000/${LOGIN_CIPHER}/wheebox_dummy_token`);
  });

  it("result: six encrypted path segments decrypt back", () => {
    const p = { domainName: "ED", testName: "VSAT", loginId: LOGIN, osr: "o", dateOfExam: "2026-11-25 15:00:00" };
    const url = buildResultUrl(C, p);
    const segs = url.replace("https://uat.wheebox.com/wheeboxApi/result/", "").split("/");
    expect(segs[0]).toBe("0275000");
    expect(wheeboxDecrypt(segs[1], C.privateKey)).toBe("ED");
    expect(wheeboxDecrypt(segs[2], C.privateKey)).toBe("VSAT");
    expect(segs[3]).toBe(LOGIN_CIPHER);
    expect(wheeboxDecrypt(segs[4], C.privateKey)).toBe("o");
    expect(wheeboxDecrypt(segs[5], C.privateKey)).toBe("2026-11-25 15:00:00");
  });

  it("register: val carries loginId + assignTests and round-trips", () => {
    const url = buildRegisterUrl(C, { loginId: "VDM-1", firstName: "Aarav", assignTests: [169872] });
    expect(url.startsWith("https://uat.wheebox.com/wheeboxAPI_v2/registration/0275000?val=")).toBe(true);
    const back = JSON.parse(wheeboxDecrypt(valOf(url), C.privateKey));
    expect(back.loginId).toBe("VDM-1");
    expect(back.assignTests).toEqual([169872]);
  });

  it("toWheeboxDate: UTC -> IST 'YYYY-MM-DD HH:MM:SS'", () => {
    expect(toWheeboxDate("2026-11-25T09:30:00Z")).toBe("2026-11-25 15:00:00");
    expect(toWheeboxDate("2026-11-25T18:30:00Z")).toBe("2026-11-26 00:00:00");
  });
});
