import { OnboardingTourView } from "./_components/OnboardingTourView";

/* Route: /repos/:repoId/onboarding-tour (Onboarding Tour, CP-7). Thin route —
   the whole page (TOC + seven section cards + generate/regenerate/share) lives
   in the colocated client view. */
export default function OnboardingTourPage() {
  return <OnboardingTourView />;
}
