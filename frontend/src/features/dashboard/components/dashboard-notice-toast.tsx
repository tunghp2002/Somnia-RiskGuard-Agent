"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import type { Notice } from "../types";

const dashboardNoticeToastId = "dashboard-notice";

const noticeMeta = {
  bad: {
    method: toast.error,
    title: "Action failed"
  },
  ok: {
    method: toast.success,
    title: "Done"
  },
  warn: {
    method: toast.warning,
    title: "Heads up"
  }
} satisfies Record<Notice["tone"], { method: typeof toast.success; title: string }>;

export function DashboardNoticeToast({ notice }: { notice: Notice | null }) {
  useEffect(() => {
    if (!notice) {
      return;
    }

    const meta = noticeMeta[notice.tone];
    const description = notice.action ? (
      <span>
        {notice.message}{" "}
        <a
          href={notice.action.url}
          rel="noreferrer"
          style={{ color: "#a855f7", textDecoration: "underline" }}
          target="_blank"
        >
          {notice.action.label}
        </a>
      </span>
    ) : notice.message;

    meta.method(meta.title, {
      description,
      closeButton: true,
      duration: notice.tone === "bad" ? 20_000 : 10_000,
      id: dashboardNoticeToastId
    });

    return () => {
      toast.dismiss(dashboardNoticeToastId);
    };
  }, [notice]);

  return null;
}
