/**
 * VSAT meetings · one set of rules, two tracks: the PI interview (0140 / 0143) and counselling (0145).
 *
 * Both work the same way (row booking, Google Meet, Join window, attendance, emails); only the names differ:
 * the database functions, the team role, the stage, the email steps and the words people see. Everything that
 * books, syncs or shows a meeting takes a Track, so the two can never drift apart.
 */

export type TrackKey = "interview" | "counselling";

export type Track = {
  key: TrackKey;
  /** words people see */
  noun: string;            // "interview" | "counselling session"
  Noun: string;            // "Interview" | "Counselling session"
  host: "interviewer" | "counsellor";
  Host: string;            // "Interviewer" | "Counsellor"
  /** the stage a booking moves the student to, and the one before it (where a cancel goes back to) */
  stage: "interview_scheduled" | "counselling_scheduled";
  fromStage: "vsat_cleared" | "pi_cleared";
  fromStageLabel: string;
  /**
   * 0164: the stages of this step. Booking no longer moves the stage (stages are changed by hand), so the form, the
   * status (Done / No-show / Rescheduled) and cancelling work at any of these — the same list as the database.
   */
  stepStages: readonly string[];
  /** request keys of the booking functions */
  hostParam: "interviewer_id" | "counsellor_id";
  linkParam: "meet_link" | "meeting_link";
  /** the key the server jobs use for the host in what they return */
  hostKey: "interviewer" | "counsellor";
  rpc: {
    assign: string; cancel: string; attendance: string; meetRetry: string; my: string;
    plan: string; draftSet: string; draftsFill: string; draftsSend: string;
    syncClaim: string; syncRelease: string; attendanceDue: string; attendanceApply: string; noticesClaim: string; noticeDone: string;
  };
  steps: {
    invite: string; rescheduled: string; cancelled: string;
    hostInvite: string; hostRescheduled: string; hostCancelled: string;
  };
  /** Google Calendar event ids: prefix + row id + "g" + generation (letters a–v and digits only) */
  eventPrefix: "vi" | "vc";
  eventTitle: string;
  /** the "run the Google + email work now" route after a save */
  syncRoute: string;
  /** analytics event for the student's Join button */
  joinEvent: string;
};

export const TRACKS: Record<TrackKey, Track> = {
  interview: {
    key: "interview", noun: "interview", Noun: "Interview", host: "interviewer", Host: "Interviewer",
    stage: "interview_scheduled", fromStage: "vsat_cleared", fromStageLabel: "VSAT cleared",
    stepStages: ["vsat_cleared", "interview_scheduled", "interviewed", "pi_not_appeared"],
    hostParam: "interviewer_id", linkParam: "meet_link", hostKey: "interviewer",
    rpc: {
      assign: "vsat_assign_interview", cancel: "vsat_cancel_interview", attendance: "vsat_set_interview_attendance",
      meetRetry: "vsat_interview_meet_retry", my: "vsat_my_interview",
      plan: "vsat_interview_plan", draftSet: "vsat_interview_draft_set", draftsFill: "vsat_interview_drafts_fill", draftsSend: "vsat_interview_drafts_send",
      syncClaim: "vsat_interview_sync_claim", syncRelease: "vsat_interview_sync_release",
      attendanceDue: "vsat_interview_attendance_due", attendanceApply: "vsat_interview_attendance_apply",
      noticesClaim: "vsat_interview_notices_claim", noticeDone: "vsat_interview_notice_done",
    },
    steps: {
      invite: "interview_invite", rescheduled: "interview_rescheduled", cancelled: "interview_cancelled",
      hostInvite: "interviewer_invite", hostRescheduled: "interviewer_rescheduled", hostCancelled: "interviewer_cancelled",
    },
    eventPrefix: "vi", eventTitle: "Vedam admissions interview", syncRoute: "/api/vsat/interviews/sync", joinEvent: "vsat_join_interview",
  },
  counselling: {
    key: "counselling", noun: "counselling session", Noun: "Counselling session", host: "counsellor", Host: "Counsellor",
    stage: "counselling_scheduled", fromStage: "pi_cleared", fromStageLabel: "PI cleared",
    stepStages: ["pi_cleared", "counselling_scheduled", "counselled", "counselling_not_appeared"],
    hostParam: "counsellor_id", linkParam: "meeting_link", hostKey: "counsellor",
    rpc: {
      assign: "vsat_assign_counsellor", cancel: "vsat_cancel_counselling", attendance: "vsat_set_counselling_attendance",
      meetRetry: "vsat_counselling_meet_retry", my: "vsat_my_counselling",
      plan: "vsat_counselling_plan", draftSet: "vsat_counselling_draft_set", draftsFill: "vsat_counselling_drafts_fill", draftsSend: "vsat_counselling_drafts_send",
      syncClaim: "vsat_counselling_sync_claim", syncRelease: "vsat_counselling_sync_release",
      attendanceDue: "vsat_counselling_attendance_due", attendanceApply: "vsat_counselling_attendance_apply",
      noticesClaim: "vsat_counselling_notices_claim", noticeDone: "vsat_counselling_notice_done",
    },
    steps: {
      invite: "counselling_invite", rescheduled: "counselling_rescheduled", cancelled: "counselling_cancelled",
      hostInvite: "counsellor_invite", hostRescheduled: "counsellor_rescheduled", hostCancelled: "counsellor_cancelled",
    },
    eventPrefix: "vc", eventTitle: "Vedam counselling session", syncRoute: "/api/vsat/counselling/sync", joinEvent: "vsat_join_counselling",
  },
};

/** All email step keys the meeting jobs send (both tracks). */
export const MEETING_STEP_KEYS: string[] = Object.values(TRACKS).flatMap((t) => Object.values(t.steps));

/**
 * The server jobs return the host under the track's own key ("interviewer" / "counsellor"); the shared code reads
 * `interviewer`. This copies it over (also inside `baseline`) without touching anything else.
 */
export function withHost<T extends Record<string, unknown>>(row: T, track: Track): T {
  if (track.hostKey === "interviewer") return row;
  const out: Record<string, unknown> = { ...row, interviewer: row[track.hostKey] ?? null };
  const base = row.baseline as Record<string, unknown> | null | undefined;
  if (base && typeof base === "object") out.baseline = { ...base, interviewer: base[track.hostKey] ?? null };
  return out as T;
}

/** Shared messages say "interviewer" / "interview"; on the counselling track they say "counsellor" / "counselling session". */
export function inTrackWords(text: string, track: Track): string {
  if (track.host === "interviewer") return text;
  return text
    .replace(/\binterviewer(s?)\b/g, "counsellor$1").replace(/\bInterviewer(s?)\b/g, "Counsellor$1")
    .replace(/\binterview(s?)\b/g, "counselling session$1").replace(/\bInterview(s?)\b/g, "Counselling session$1");
}
