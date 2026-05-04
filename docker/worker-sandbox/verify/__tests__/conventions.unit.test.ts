import { describe, expect, test } from "bun:test";
import { gateConventions } from "../gates/conventions";

describe("gateConventions", () => {
    test("passes when no profile configured", () => {
        const r = gateConventions("anything goes", "body", undefined);
        expect(r.pass).toBe(true);
    });

    test("conventional_commits: passes for valid title", () => {
        const r = gateConventions("docs(claude): note railway auth", "body", { titleFormat: "conventional_commits" });
        expect(r.pass).toBe(true);
    });

    test("conventional_commits: fails for invalid title", () => {
        const r = gateConventions("Update CLAUDE.md", "body", { titleFormat: "conventional_commits" });
        expect(r.pass).toBe(false);
        expect(r.reason).toContain("conventional_commits");
    });

    test("ticket_prefix: passes for ABC-123:", () => {
        const r = gateConventions("ABC-123: do thing", "body", { titleFormat: "ticket_prefix" });
        expect(r.pass).toBe(true);
    });

    test("ticket_prefix: passes for [ABC-123] form", () => {
        const r = gateConventions("[ABC-123] do thing", "body", { titleFormat: "ticket_prefix" });
        expect(r.pass).toBe(true);
    });

    test("ticket_prefix: fails for plain title", () => {
        const r = gateConventions("just a title", "body", { titleFormat: "ticket_prefix" });
        expect(r.pass).toBe(false);
    });

    test("plain title format: anything passes", () => {
        const r = gateConventions("whatever", "body", { titleFormat: "plain" });
        expect(r.pass).toBe(true);
    });

    test("signOffRequired: passes when body has Signed-off-by", () => {
        const r = gateConventions("docs: x", "body\n\nSigned-off-by: Foo Bar <foo@bar.com>", {
            titleFormat: "plain",
            signOffRequired: true,
        });
        expect(r.pass).toBe(true);
    });

    test("signOffRequired: fails when body lacks Signed-off-by", () => {
        const r = gateConventions("docs: x", "body without sign off", {
            titleFormat: "plain",
            signOffRequired: true,
        });
        expect(r.pass).toBe(false);
        expect(r.reason).toContain("signOff");
    });

    test("dcoRequired: equivalent to signOffRequired", () => {
        const r = gateConventions("docs: x", "body without it", { dcoRequired: true });
        expect(r.pass).toBe(false);
    });

    test("multiple violations reported", () => {
        const r = gateConventions("bad title", "no signoff", {
            titleFormat: "conventional_commits",
            signOffRequired: true,
        });
        expect(r.pass).toBe(false);
        expect(r.reason).toContain("conventional_commits");
        expect(r.reason).toContain("signOff");
    });
});
