/* Root — sends the user to the first repo's PR list, or onboarding if no repos. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRepos } from "../lib/hooks";
import { AppShell } from "../components/app-shell";
import { PageContainer } from "../components/page-shell";
import { EmptyState, Button, Skeleton } from "@devdigest/ui";

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations("home");
  const { data: repos, isLoading, isError } = useRepos();

  React.useEffect(() => {
    if (repos && repos.length > 0) {
      router.replace(`/repos/${repos[0]!.id}/pulls`);
    }
  }, [repos, router]);

  return (
    <AppShell crumb={[{ label: "DevDigest" }]}>
      <PageContainer title={t("title")} subtitle={t("subtitle")}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
            <Skeleton height={20} width={240} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : isError || !repos || repos.length === 0 ? (
          <EmptyState
            icon="GitBranch"
            title={t("emptyTitle")}
            body={t("emptyBody")}
            cta={t("cta")}
            onCta={() => router.push("/onboarding")}
          />
        ) : (
          <div>
            <p style={{ color: "var(--text-secondary)", marginBottom: 14 }}>{t("redirecting")}</p>
            <Button kind="primary" onClick={() => router.push(`/repos/${repos[0]!.id}/pulls`)}>
              {t("open", { name: repos[0]!.full_name })}
            </Button>
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}
