import { describe, expect, it } from "vitest";

import {
  DOCUMENT_UPLOAD_POLICY,
  contentDisposition,
  parseVersionUploadForm,
} from "./document-rows";

const file = (bytes: Uint8Array, name: string, type = "application/pdf"): FormData => {
  const form = new FormData();
  form.append("file", new File([Uint8Array.from(bytes)], name, { type }));
  return form;
};

describe("parseVersionUploadForm", () => {
  it("reads the file bytes, name, type and notes", async () => {
    const bytes = new TextEncoder().encode("hello file");
    const form = file(bytes, "handbook.pdf");
    form.append("notes", "  first revision  ");

    const parsed = await parseVersionUploadForm(form);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.filename).toBe("handbook.pdf");
    expect(parsed.input.mime).toBe("application/pdf");
    expect(parsed.input.bytes).toEqual(bytes);
    expect(parsed.input.notes).toBe("first revision");
  });

  it("rejects a file whose declared type is outside the document allow-list", async () => {
    const form = file(new TextEncoder().encode("x"), "notes.bin", "");

    expect((await parseVersionUploadForm(form)).ok).toBe(false);
  });

  it("rejects an oversize file before it reaches the storage port", async () => {
    const form = file(
      new Uint8Array(DOCUMENT_UPLOAD_POLICY.maxBytes + 1),
      "huge.pdf",
      "application/pdf",
    );

    expect((await parseVersionUploadForm(form)).ok).toBe(false);
  });

  it("treats a blank notes field as absent", async () => {
    const form = file(new TextEncoder().encode("x"), "notes.txt");
    form.append("notes", "   ");

    const parsed = await parseVersionUploadForm(form);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.notes).toBeNull();
  });

  it("rejects a form with no file part", async () => {
    const form = new FormData();
    form.append("notes", "missing file");

    expect((await parseVersionUploadForm(form)).ok).toBe(false);
  });

  it("rejects an empty file", async () => {
    expect((await parseVersionUploadForm(file(new Uint8Array(0), "empty.txt"))).ok).toBe(false);
  });

  it("rejects an over-long filename", async () => {
    const form = file(new TextEncoder().encode("x"), `${"a".repeat(256)}.txt`);

    expect((await parseVersionUploadForm(form)).ok).toBe(false);
  });

  it("rejects over-long notes", async () => {
    const form = file(new TextEncoder().encode("x"), "notes.txt");
    form.append("notes", "a".repeat(2001));

    expect((await parseVersionUploadForm(form)).ok).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("quotes the filename and adds the RFC 5987 form", () => {
    expect(contentDisposition("handbook.pdf")).toBe(
      "attachment; filename=\"handbook.pdf\"; filename*=UTF-8''handbook.pdf",
    );
  });

  it("sanitizes quotes, backslashes and non-ASCII in the ASCII fallback", () => {
    const value = contentDisposition('a"b\\c\né.txt');

    expect(value).toContain('filename="a_b_c__.txt"');
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent('a"b\\c\né.txt')}`);
    expect(value).not.toContain("\n");
  });

  it("uses a generic name for an empty filename", () => {
    expect(contentDisposition("")).toContain('filename="download"');
  });
});
