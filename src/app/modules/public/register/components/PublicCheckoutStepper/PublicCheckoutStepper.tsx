import { Link } from "react-router-dom";
import "./PublicCheckoutStepper.css";

type Props = {
  currentStep: 1 | 2 | 3;
  orgSlug: string;
  eventSlug: string;
};

const steps = [
  { number: 1, label: "Billets", path: "billets" },
  { number: 2, label: "Participants", path: "participants" },
  { number: 3, label: "Validation", path: "paiement" },
] as const;

export function PublicCheckoutStepper({
  currentStep,
  orgSlug,
  eventSlug,
}: Props) {
  return (
    <nav
      className="publicCheckoutStepper"
      aria-label="Progression de la réservation"
    >
      {steps.map((step) => {
        const isCurrent = step.number === currentStep;
        const isComplete = step.number < currentStep;
        const content = (
          <>
            <span className="publicCheckoutStepNumber" aria-hidden="true">
              {isComplete ? "✓" : step.number}
            </span>
            <span className="publicCheckoutStepLabel">{step.label}</span>
          </>
        );

        return isComplete ? (
          <Link
            key={step.number}
            className="publicCheckoutStep isComplete"
            to={`/o/${orgSlug}/e/${eventSlug}/${step.path}`}
          >
            {content}
          </Link>
        ) : (
          <span
            key={step.number}
            className={`publicCheckoutStep ${isCurrent ? "isCurrent" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            {content}
          </span>
        );
      })}
    </nav>
  );
}
