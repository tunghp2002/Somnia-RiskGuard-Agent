"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import type { Notice } from "../types";

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
    meta.method(meta.title, {
      description: notice.message
    });
  }, [notice]);

  return null;
}
