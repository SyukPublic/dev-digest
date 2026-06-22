"use client";

/* Route-level error boundary — catches render/runtime errors in the page tree
   (the layout, providers and intl context stay mounted) and offers a retry,
   instead of crashing to a blank screen. Data-fetch errors are still handled
   inline as empty/ErrorState by each page; this is the last-resort net. */
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  return <ErrorState fullScreen title={t("states.error")} body={error.message} onRetry={reset} />;
}
