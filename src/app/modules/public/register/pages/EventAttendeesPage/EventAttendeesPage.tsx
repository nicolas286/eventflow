import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@gateways/supabase/supabaseClient";
import { usePublicEventDetail } from "../../../events/hooks/usePublicEventDetail";

import Container from "@ui/components/container/Container";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";
import Badge from "@ui/components/badge/Badge";

import { PublicEventHeader } from "../../components/PublicEventHeader";
import { PublicCheckoutStepper } from "../../components/PublicCheckoutStepper/PublicCheckoutStepper";
import { PublicStickyCheckoutBar } from "../../components/PublicStickyCheckoutBar/PublicStickyCheckoutBar";
import { PublicAttendeeField } from "../../components/PublicAttendeeField/PublicAttendeeField";
import { useEventAttendeesPage } from "./useEventAttendeesPage";

import "@app/layouts/publicCheckoutBase.desktop.css";
import "./EventAttendeesPage.desktop.css";
import "./EventAttendeesPage.mobile.css";

type EventAttendeesPageContentProps = {
  orgSlug: string;
  eventSlug: string;
};

function EventAttendeesPageContent({
  orgSlug,
  eventSlug,
}: EventAttendeesPageContentProps) {
  const navigate = useNavigate();

  const { loading, error, data } = usePublicEventDetail({
    supabase,
    orgSlug,
    eventSlug,
  });

  const {
    attTouched,
    attemptedNext,
    totalTickets,
    totalCents,
    currency,
    attendeesCount,
    sortedFields,
    groupedFieldSections,
    slots,
    attendeeErrors,
    setAnswer,
    touchField,
    goBack,
    goNext,
  } = useEventAttendeesPage({
    orgSlug,
    eventSlug,
    data,
    navigate,
  });

  if (loading) {
    return (
      <div className="publicPage">
        <Container>Chargement…</Container>
      </div>
    );
  }

  if (error) {
    return (
      <div className="publicPage">
        <Container>Erreur : {error}</Container>
      </div>
    );
  }

  if (!data?.event) {
    return (
      <div className="publicPage">
        <Container>Événement introuvable.</Container>
      </div>
    );
  }

  const { org, event } = data;

  return (
    <div className="publicPage">
      <Container>
        <div className="publicSurface">
          <PublicEventHeader
            orgSlug={orgSlug}
            org={org}
            event={event}
            compact
          />

          <PublicCheckoutStepper
            currentStep={2}
            orgSlug={orgSlug}
            eventSlug={eventSlug}
          />

          <div className="publicDivider" />

          <div className="publicSectionHeading">
            <div>
              <div className="publicEyebrow">Informations</div>
              <h2 className="publicSectionTitle">Qui participe&nbsp;?</h2>
            </div>
            <p>
              Renseignez les informations demandées pour chaque participant.
            </p>
          </div>

          {totalTickets <= 0 ? (
            <div className="publicEmpty">
              Aucun billet sélectionné. Reviens à l’étape “Billets”.
            </div>
          ) : attendeesCount === 0 ? (
            <div className="publicEmpty">
              Aucun formulaire participant n’est requis pour ces billets.
            </div>
          ) : sortedFields.length === 0 ? (
            <div className="publicEmpty">
              Aucun champ configuré pour le formulaire.
            </div>
          ) : (
            <div className="publicGutter">
              <div className="publicList">
                {slots.map((att, idx) => {
                  const rowErrs = attendeeErrors[idx] ?? {};
                  const rowTouched = attTouched[idx] ?? {};

                  return (
                    <Card key={idx} className="publicAttendeeCard">
                      <CardHeader
                        title={
                          <div className="publicCardTitle">
                            Participant {idx + 1}
                          </div>
                        }
                        right={
                          <Badge
                            tone="neutral"
                            label={
                              sortedFields.some((f) => f.isRequired)
                                ? "Champs requis"
                                : "Optionnel"
                            }
                          />
                        }
                      />
                      <CardBody>
                        <div className="publicGroupedFields">
                          {groupedFieldSections.map((section) => (
                            <div
                              key={section.group?.id ?? "ungrouped"}
                              className="publicFieldGroupSection"
                            >
                              {section.group ? (
                                <div className="publicFieldGroupHeader">
                                  <div className="publicFieldGroupTitle">
                                    {section.group.label}
                                  </div>
                                  {section.group.description ? (
                                    <div className="publicFieldGroupDescription">
                                      {section.group.description}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              <div className="publicGrid2">
                                {section.fields.map((field) => {
                                  const fieldKey = String(
                                    field.fieldKey ?? "",
                                  ).trim();
                                  if (!fieldKey) return null;

                                  return (
                                    <PublicAttendeeField
                                      key={field.id}
                                      field={field}
                                      value={att.values?.[fieldKey]}
                                      error={rowErrs[fieldKey]}
                                      touched={!!rowTouched[fieldKey]}
                                      attemptedNext={attemptedNext}
                                      onChange={(value, opts) =>
                                        setAnswer(idx, fieldKey, value, opts)
                                      }
                                      onBlur={() => touchField(idx, fieldKey)}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          <div className="publicDivider" />

          <div className="publicBackActions">
            <Button
              variant="secondary"
              label="Retour aux billets"
              onClick={goBack}
            />
          </div>
        </div>
      </Container>

      <PublicStickyCheckoutBar
        amountCents={totalCents}
        currency={currency}
        primaryText={`${totalTickets} billet(s)`}
        secondaryText={`${attendeesCount} participant(s)`}
        onClick={goNext}
        disabled={totalTickets <= 0}
        ctaLabel="Continuer →"
      />
    </div>
  );
}

export function EventAttendeesPage() {
  const { orgSlug, eventSlug } = useParams<{
    orgSlug: string;
    eventSlug: string;
  }>();

  if (!orgSlug || !eventSlug) {
    return (
      <div className="publicPage">
        <Container>Chargement…</Container>
      </div>
    );
  }

  return (
    <EventAttendeesPageContent
      key={`${orgSlug}:${eventSlug}`}
      orgSlug={orgSlug}
      eventSlug={eventSlug}
    />
  );
}

export default EventAttendeesPage;
