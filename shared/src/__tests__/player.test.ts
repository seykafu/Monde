import { describe, expect, it } from "vitest";
import {
  BACKGROUND_STARTS, CharacterLookData, PlayerProfile, baseSkills, checkCustomPronouns, checkName, pronounSet, regardStartsFor, startingSkills,
} from "../index";

const base = { name: "Ada", pronouns: "she/her", background: "tinkerer", why: "to_help", loves: "old books" };

describe("the Fellowship application schema (§11.1)", () => {
  it("accepts the form's choices and normalises case and spacing", () => {
    expect(PlayerProfile.parse({ ...base, name: "  Ada  ", pronouns: "She/Her", loves: " Old Books " })).toEqual(base);
    expect(PlayerProfile.parse({ ...base, pronouns: "xe/xem/xyr" }).pronouns).toBe("xe/xem/xyr");
  });

  it("reads §13.3's why ids and the old running_from_something", () => {
    for (const why of ["fresh_start", "to_help", "running", "curious"]) expect(PlayerProfile.parse({ ...base, why }).why).toBe(why);
    expect(PlayerProfile.parse({ ...base, why: "running_from_something" }).why).toBe("running");
    expect(PlayerProfile.safeParse({ ...base, why: "money" }).success).toBe(false);
  });

  it("takes only the twelve loves, and nothing extra", () => {
    for (const loves of ["rain", "the sea", "bread", "music", "puzzles", "flowers", "the stars", "cats", "boats", "tea", "old clocks"]) {
      expect(PlayerProfile.parse({ ...base, loves }).loves).toBe(loves);
    }
    expect(PlayerProfile.safeParse({ ...base, loves: "sunsets" }).success).toBe(false);
    expect(PlayerProfile.safeParse({ ...base, nickname: "Ace" }).success).toBe(false);
  });

  it("checks names the same way on both sides", () => {
    for (const bad of ["", "   ", "A".repeat(17), "<b>Ada", "{x}", "1234", "Ada\u0007"]) expect(PlayerProfile.safeParse({ ...base, name: bad }).success).toBe(false);
    expect(checkName("  Ada   Lune ")).toEqual({ ok: true, name: "Ada Lune" });
    expect(checkName("").ok).toBe(false);
    expect(checkName("Ada!")).toMatchObject({ ok: false, problem: expect.stringMatching(/Letters, spaces/) });
    expect(checkCustomPronouns(["xe", "xem", "xyr"])).toBeNull();
    expect(checkCustomPronouns(["xe", "xem", ""])).toBeTruthy();
  });

  it("splits pronouns into their three words", () => {
    expect(pronounSet("he/him")).toEqual({ subject: "he", object: "him", possessive: "his" });
    expect(pronounSet("they/them")).toEqual({ subject: "they", object: "them", possessive: "their" });
    expect(pronounSet("ze/zir/zirs")).toEqual({ subject: "ze", object: "zir", possessive: "zirs" });
  });
});

describe("Background starts (§11.1, §11.2)", () => {
  it("raise one skill to 2 (the rest start at 1) and give a Homecomer six old neighbours at Regard 20", () => {
    expect(baseSkills()).toEqual({ handiwork: { level: 1, xp: 0 }, wits: { level: 1, xp: 0 }, heart: { level: 1, xp: 0 }, grit: { level: 1, xp: 0 } });
    expect(startingSkills("tinkerer").handiwork.level).toBe(2);
    expect(startingSkills("scrapper").grit.level).toBe(2);
    expect(startingSkills("organizer").heart.level).toBe(2);
    expect(startingSkills("homecomer")).toEqual(baseSkills());
    expect(BACKGROUND_STARTS.homecomer.regard).toEqual({ pell: 20, bertrand: 20, odile: 20, hollis: 20, rosalind: 20, delphine: 20 });
  });

  it("apply Regard only when the Background changes to one that has some", () => {
    expect(Object.keys(regardStartsFor(null, { background: "homecomer" }))).toHaveLength(6);
    expect(regardStartsFor({ background: "tinkerer" }, { background: "homecomer" }).pell).toBe(20);
    expect(regardStartsFor({ background: "homecomer" }, { background: "homecomer" })).toEqual({});
    expect(regardStartsFor(null, { background: "scrapper" })).toEqual({});
  });
});

describe("the look as save data", () => {
  it("accepts a resident's plain look and a full §11.1 look, and rejects unknown styles", () => {
    const plain = { kind: "human", skin: 1, hair: 2, hairStyle: "bob", eyes: 3, top: 4, bottom: 5, bottomStyle: "skirt", shoes: 6, accessory: "none", accessoryColour: 7 };
    expect(CharacterLookData.parse(plain)).toEqual(plain);
    const full = { ...plain, hairStyle: "braids", build: "broad", height: "short", outfit: "dungarees", trim: 0xffffff };
    expect(CharacterLookData.parse(full)).toEqual(full);
    expect(CharacterLookData.safeParse({ ...plain, hairStyle: "mohawk" }).success).toBe(false);
    expect(CharacterLookData.safeParse({ ...plain, top: 0x1000000 }).success).toBe(false);
    expect(CharacterLookData.safeParse({ ...plain, hat: "cap" }).success).toBe(false);
  });
});
