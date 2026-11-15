"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { uploadApi } from "../../lib/mock-api";
import type { Option } from "../../lib/types";
import { CHECKLIST, EMPTY_FORM, MAX_ROWS, MAX_ROWS_LABEL, fmt, guessMapping, type FormValues, type StepIndex } from "./constants";

export type EntryList = { id: string; name: string };
export type PickedFile = { name: string; headers: string[]; sample: string[][]; rowCount: number };
export type Done = { jobId: string; rows: number; imported: number; listName: string; tag: string };

type Opts =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; institutes: Option[]; forms: Option[] };

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * All wizard state + transitions in one place, so the step components stay
 * presentational. Every call goes through `uploadApi` — nothing leaves the
 * browser in this mock.
 */
export function useUploadWizard(entry: EntryList | undefined, notify: (msg: string) => void) {
  const [opts, setOpts] = useState<Opts>({ status: "loading" });
  const [step, setStep] = useState<StepIndex>(entry ? 1 : 0);
  const [list, setList] = useState<EntryList | null>(entry ?? null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<"institute" | "name", string>>>({});
  const [ack, setAck] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [tagOn, setTagOn] = useState(false);
  const [tag, setTag] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [attemptedMap, setAttemptedMap] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const loadOptions = useCallback(() => {
    setOpts({ status: "loading" });
    uploadApi.setupOptions()
      .then((o) => setOpts({ status: "ready", ...o }))
      .catch((e) => setOpts({ status: "error", message: errText(e, "We could not load the setup options.") }));
  }, []);
  useEffect(loadOptions, [loadOptions]);

  const ackCount = ack.filter(Boolean).length;

  /* ── mapping checks ── */
  const used = useMemo(() => Object.values(mapping).filter(Boolean), [mapping]);
  const mappedCount = used.length;
  const dupTarget = used.length !== new Set(used).size;
  const hasContact = used.includes("email") || used.includes("mobile");
  const mapError = dupTarget
    ? "Two columns are mapped to the same field. Pick a different field for one of them."
    : attemptedMap && !hasContact
      ? "Map at least one column to Email or Mobile number so contacts can be imported."
      : null;

  /* ── file ── */
  const chooseFile = async (f: File) => {
    setFileError(null); setFile(null); setSubmitError(null);
    if (!/\.csv$/i.test(f.name)) { setFileError("Only .csv files can be uploaded. Save your sheet as CSV and try again."); return; }
    if (f.size === 0) { setFileError("That file is empty. Add your contacts and try again."); return; }
    setReading(true);
    try {
      const parsed = uploadApi.parseCsv(await f.text());
      if (!parsed.headers.length || parsed.rowCount < 1) {
        setFileError("No contacts found. Keep the column names in row 1 and add at least one contact below it.");
      } else if (parsed.rowCount > MAX_ROWS) {
        setFileError(`This file has ${fmt(parsed.rowCount)} rows. The limit is ${MAX_ROWS_LABEL} per upload, so split it into parts.`);
      } else {
        setFile({ name: f.name, ...parsed });
        setMapping(guessMapping(parsed.headers));
        setAttemptedMap(false);
      }
    } catch {
      setFileError("We could not read that file. Try again, or pick a different file.");
    } finally {
      setReading(false);
    }
  };
  const removeFile = () => { setFile(null); setFileError(null); setMapping({}); setSubmitError(null); };

  /* ── navigation ── */
  const run = async (fn: () => Promise<void>, failMsg: string) => {
    setPending(true); setSubmitError(null);
    try { await fn(); } catch (e) { setSubmitError(errText(e, failMsg)); } finally { setPending(false); }
  };

  const next = async () => {
    if (pending) return;
    if (step === 0) {
      if (list) { setStep(1); return; }
      const errs: typeof formErrors = {};
      if (!form.institute) errs.institute = "Choose an institute.";
      if (form.name.trim().length < 2) errs.name = "Enter a list name (at least 2 characters).";
      setFormErrors(errs);
      if (Object.keys(errs).length) return;
      await run(async () => {
        const res = await uploadApi.createList({ ...form, name: form.name.trim() });
        setList({ id: res.listId, name: form.name.trim() });
        notify(`List “${form.name.trim()}” created`);
        setStep(1);
      }, "We could not create the list. Please try again.");
    } else if (step === 1) {
      if (ackCount === CHECKLIST.length) setStep(2);
    } else if (step === 2) {
      if (!file) { setFileError("Choose a .csv file to continue."); return; }
      await run(async () => {
        await uploadApi.stageFile({ name: file.name, rows: file.rowCount, columns: file.headers.length });
        setStep(3);
      }, "We could not upload the file. Please try again.");
    } else if (step === 3 && file) {
      setAttemptedMap(true);
      if (dupTarget || !hasContact) return;
      await run(async () => {
        const res = await uploadApi.commit({ listId: list?.id, file: file.name, rows: file.rowCount, mapping, tag: tagOn ? tag.trim() : "" });
        setDone({ jobId: String(res.jobId), rows: file.rowCount, imported: mappedCount, listName: list?.name ?? "", tag: tagOn ? tag.trim() : "" });
        notify(`Import queued · ${res.jobId}`);
      }, "We could not start the import. Please try again.");
    }
  };

  /** Back goes one step; returns true when it handled it (false = caller should leave the wizard). */
  const back = () => {
    setSubmitError(null);
    const floor = entry ? 1 : 0;
    if (step > floor) { setStep((s) => (s - 1) as StepIndex); return true; }
    return false;
  };

  const reset = () => {
    setStep(entry ? 1 : 0); setList(entry ?? null); setForm(EMPTY_FORM); setFormErrors({});
    setAck(CHECKLIST.map(() => false)); setTagOn(false); setTag("");
    setFile(null); setFileError(null); setMapping({}); setAttemptedMap(false);
    setSubmitError(null); setDone(null);
  };

  return {
    opts, loadOptions, step, list, form, setForm: (v: FormValues) => { setForm(v); setFormErrors({}); }, formErrors,
    ack, setAck, ackCount, tagOn, setTagOn, tag, setTag,
    file, fileError, reading, chooseFile, removeFile,
    mapping, setMapping, mappedCount, dupTarget, mapError,
    pending, submitError, done, next, back, reset,
  };
}
