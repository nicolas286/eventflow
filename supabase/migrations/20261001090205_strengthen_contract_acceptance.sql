begin;

-- No existing organization is silently opted into the new agreements.
alter table public.organization_profile
 add column seller_legal_name text,
 add column seller_address text,
 add column seller_business_number text,
 add column seller_type text check (seller_type in ('professional','non_professional')),
 add column connect_terms_accepted_version text,
 add column dpa_accepted_version text,
 add column platform_terms_accepted_version text,
 add column privacy_accepted_version text,
 add column platform_agreements_accepted_at timestamptz,
 add column platform_agreements_accepted_by uuid references auth.users(id) on delete set null;
alter table public.orders add column platform_terms_snapshot text,
 add column organizer_identity_snapshot jsonb;

create table private.legal_document_versions (
 document_key text not null,
 version text not null,
 body text not null check (char_length(body)>100),
 primary key(document_key,version)
);
alter table private.legal_document_versions enable row level security;
revoke all on private.legal_document_versions from public,anon,authenticated,service_role;
grant select on private.legal_document_versions to service_role;

create table private.organization_platform_acceptances (
 id uuid primary key default gen_random_uuid(),
 -- Retain the audit reference after operational account deletion.
 org_id uuid not null,
 accepted_by uuid not null,
 signer_email text,
 organization_identity_snapshot jsonb not null,
 connect_version text not null,
 dpa_version text not null,
 platform_terms_version text not null,
 privacy_version text not null,
 connect_snapshot text not null,
 dpa_snapshot text not null,
 platform_terms_snapshot text not null,
 privacy_snapshot text not null,
 accepted_at timestamptz not null default now()
);
alter table private.organization_platform_acceptances enable row level security;
revoke all on private.organization_platform_acceptances from public, anon, authenticated, service_role;
grant select, insert on private.organization_platform_acceptances to service_role;
create index on private.organization_platform_acceptances(org_id, accepted_at desc);

create or replace function public.update_organization_seller_identity(
 p_org_id uuid, p_legal_name text, p_address text, p_business_number text,
 p_seller_type text, p_phone text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_profile public.organization_profile%rowtype;
begin
 if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
 if not exists (select 1 from public.organization_members where org_id=p_org_id and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
 if char_length(trim(coalesce(p_legal_name,''))) not between 2 and 200
 or char_length(trim(coalesce(p_address,''))) not between 8 and 500
 or char_length(trim(coalesce(p_phone,''))) not between 6 and 32
 or p_seller_type is null or p_seller_type not in ('professional','non_professional')
 or char_length(coalesce(p_business_number,'')) > 100 then raise exception 'SELLER_IDENTITY_INVALID'; end if;
 update public.organization_profile set seller_legal_name=trim(p_legal_name), seller_address=trim(p_address),
 seller_business_number=nullif(trim(p_business_number),''), seller_type=p_seller_type, phone=trim(p_phone),
 sales_terms_version=case when (seller_legal_name,seller_address,seller_business_number,seller_type,phone) is distinct from (trim(p_legal_name),trim(p_address),nullif(trim(p_business_number),''),p_seller_type,trim(p_phone)) then 'custom-'||gen_random_uuid()::text else sales_terms_version end,
 updated_at=now() where org_id=p_org_id returning * into v_profile;
 if not found then raise exception 'NOT_FOUND'; end if;
 return to_jsonb(v_profile);
end; $$;
revoke all on function public.update_organization_seller_identity(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.update_organization_seller_identity(uuid,text,text,text,text,text) to authenticated;

create or replace function public.accept_organization_platform_agreements(p_org_id uuid,p_connect_version text,p_dpa_version text,p_platform_terms_version text,p_privacy_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_connect text; v_dpa text; v_terms text; v_privacy text; v_signer_email text; v_identity jsonb;
begin
 if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
 if not exists(select 1 from public.organization_members where org_id=p_org_id and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
 if p_connect_version is distinct from '2026-10-01' or p_dpa_version is distinct from '2026-10-01' or p_platform_terms_version is distinct from '2026-10-01' or p_privacy_version is distinct from '2026-10-01' then raise exception 'PLATFORM_AGREEMENTS_CHANGED'; end if;
 select body into v_connect from private.legal_document_versions where document_key='connect' and version=p_connect_version;
 select body into v_dpa from private.legal_document_versions where document_key='dpa' and version=p_dpa_version;
 select body into v_terms from private.legal_document_versions where document_key='platform_terms' and version=p_platform_terms_version;
 select body into v_privacy from private.legal_document_versions where document_key='privacy' and version=p_privacy_version;
 if v_connect is null or v_dpa is null or v_terms is null or v_privacy is null then raise exception 'PLATFORM_AGREEMENTS_UNAVAILABLE'; end if;
 perform private.assert_rate_limit('platform_terms:'||auth.uid()::text,10,60);
 update public.organization_profile set connect_terms_accepted_version=p_connect_version,dpa_accepted_version=p_dpa_version,platform_terms_accepted_version=p_platform_terms_version,privacy_accepted_version=p_privacy_version,
 platform_agreements_accepted_at=now(),platform_agreements_accepted_by=auth.uid(),updated_at=now() where org_id=p_org_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 select email into v_signer_email from auth.users where id=auth.uid();
 select jsonb_build_object('display_name',display_name,'legal_name',seller_legal_name,'business_number',seller_business_number,'public_email',public_email) into v_identity from public.organization_profile where org_id=p_org_id;
 insert into private.organization_platform_acceptances(org_id,accepted_by,signer_email,organization_identity_snapshot,connect_version,dpa_version,platform_terms_version,privacy_version,connect_snapshot,dpa_snapshot,platform_terms_snapshot,privacy_snapshot) values(p_org_id,auth.uid(),v_signer_email,v_identity,p_connect_version,p_dpa_version,p_platform_terms_version,p_privacy_version,v_connect,v_dpa,v_terms,v_privacy);
 return jsonb_build_object('connectTermsAcceptedVersion',p_connect_version,'dpaAcceptedVersion',p_dpa_version,'platformTermsAcceptedVersion',p_platform_terms_version,'privacyAcceptedVersion',p_privacy_version,'platformAgreementsAcceptedAt',now());
end; $$;
revoke all on function public.accept_organization_platform_agreements(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.accept_organization_platform_agreements(uuid,text,text,text,text) to authenticated;

-- Audit fields cannot be forged by a direct profile update. Security-definer
-- manager RPCs execute as the table owner; ordinary API callers do not.
create function private.guard_profile_contract_fields() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then
   if new.sales_terms_accepted_at is not null or new.platform_agreements_accepted_at is not null or new.sales_terms_accepted_version is not null or new.connect_terms_accepted_version is not null or new.dpa_accepted_version is not null or new.platform_terms_accepted_version is not null or new.privacy_accepted_version is not null then raise exception 'FORBIDDEN'; end if;
  elsif (new.sales_terms_version,new.sales_terms_accepted_version,new.sales_terms_accepted_at,new.sales_terms_accepted_by,new.connect_terms_accepted_version,new.dpa_accepted_version,new.platform_terms_accepted_version,new.privacy_accepted_version,new.platform_agreements_accepted_at,new.platform_agreements_accepted_by)
   is distinct from (old.sales_terms_version,old.sales_terms_accepted_version,old.sales_terms_accepted_at,old.sales_terms_accepted_by,old.connect_terms_accepted_version,old.dpa_accepted_version,old.platform_terms_accepted_version,old.privacy_accepted_version,old.platform_agreements_accepted_at,old.platform_agreements_accepted_by) then raise exception 'FORBIDDEN'; end if;
 end if;
 if tg_op='UPDATE' and (new.sales_terms,new.display_name,new.public_email,new.phone,new.seller_legal_name,new.seller_address,new.seller_business_number,new.seller_type)
 is distinct from (old.sales_terms,old.display_name,old.public_email,old.phone,old.seller_legal_name,old.seller_address,old.seller_business_number,old.seller_type)
 and new.sales_terms_version is not distinct from old.sales_terms_version then
  new.sales_terms_version:='custom-'||gen_random_uuid()::text;
 end if;
 return new;
end; $$;
create trigger guard_profile_contract_fields before insert or update on public.organization_profile for each row execute function private.guard_profile_contract_fields();

create or replace function public.assert_organization_contract_ready(p_org_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare p public.organization_profile%rowtype;
begin
 select * into p from public.organization_profile where org_id=p_org_id;
 if not found or char_length(trim(coalesce(p.seller_legal_name,'')))<2 or char_length(trim(coalesce(p.seller_address,'')))<8 or char_length(trim(coalesce(p.phone,'')))<6 or p.seller_type is null then raise exception 'ORGANIZER_SELLER_IDENTITY_REQUIRED'; end if;
 if not exists(select 1 from private.organization_platform_acceptances where org_id=p_org_id and connect_version='2026-10-01' and dpa_version='2026-10-01' and platform_terms_version='2026-10-01' and privacy_version='2026-10-01') then raise exception 'ORGANIZER_PLATFORM_AGREEMENTS_REQUIRED'; end if;
 if p.sales_terms_accepted_at is null or p.sales_terms_accepted_version is distinct from p.sales_terms_version
 or trim(coalesce(p.public_email,'')) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'ORGANIZER_SALES_TERMS_REQUIRED'; end if;
end; $$;
revoke all on function public.assert_organization_contract_ready(uuid) from public,anon,authenticated;
grant execute on function public.assert_organization_contract_ready(uuid) to service_role;

-- The old endpoint cannot manufacture proof for an unspecified displayed version.
create or replace function public.record_order_terms_acceptance(p_order_id uuid,p_platform_terms_version text) returns void
language plpgsql security definer set search_path=pg_catalog as $$ begin raise exception 'TERMS_CHANGED_RELOAD'; end; $$;

create function public.create_order_intent_with_terms(p_event_id uuid,p_items jsonb,p_attendees jsonb,p_buyer jsonb,p_rate_key text,p_promo_code text,
 p_platform_terms_version text,p_platform_terms_snapshot text,p_organizer_sales_terms_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_org uuid; p public.organization_profile%rowtype; v_order jsonb; v_paid boolean;
begin
 if p_platform_terms_version is distinct from '2026-10-01' or char_length(coalesce(p_platform_terms_snapshot,''))<100 then raise exception 'TERMS_CHANGED_RELOAD'; end if;
 select org_id into v_org from public.events where id=p_event_id;
 select * into p from public.organization_profile where org_id=v_org for share;
 if p_organizer_sales_terms_version is not null and p_organizer_sales_terms_version is distinct from p.sales_terms_version then raise exception 'TERMS_CHANGED_RELOAD'; end if;
 v_order:=public.create_order_intent(p_event_id,p_items,p_attendees,p_buyer,p_rate_key,p_promo_code);
 v_paid:=coalesce((v_order->>'payment_required')::boolean,false) and coalesce((v_order->>'amount_due_now_cents')::integer,0)>0;
 if v_paid then
  perform public.assert_organization_contract_ready(v_org);
  if p_organizer_sales_terms_version is distinct from p.sales_terms_version then raise exception 'TERMS_CHANGED_RELOAD'; end if;
  if not exists (
   select 1 from public.organizations o
   join public.user_profile u on u.user_id=o.created_by
   where o.id=v_org and o.status='active' and o.payments_provider='stripe'
    and u.stripe_connect_allowed=true and o.stripe_connected_account_id is not null
    and o.stripe_compliance_verified=true and o.stripe_details_submitted=true
    and o.stripe_charges_enabled=true and o.stripe_payouts_enabled=true
    and o.stripe_requirements_disabled_reason is null
    and jsonb_array_length(o.stripe_requirements_currently_due)=0
  ) then raise exception 'ORG_STRIPE_ONBOARDING_INCOMPLETE'; end if;
 end if;
 update public.orders set platform_terms_version=p_platform_terms_version,platform_terms_snapshot=p_platform_terms_snapshot,
 organizer_sales_terms_version=case when p_organizer_sales_terms_version is not null then p.sales_terms_version end,
 organizer_sales_terms_snapshot=case when p_organizer_sales_terms_version is not null then p.sales_terms end,
 organizer_display_name_snapshot=p.display_name,
 organizer_identity_snapshot=jsonb_build_object('display_name',p.display_name,'legal_name',p.seller_legal_name,'address',p.seller_address,'business_number',p.seller_business_number,'seller_type',p.seller_type,'email',p.public_email,'phone',p.phone,'website',p.website),
 terms_accepted_at=now() where id=(v_order->>'order_id')::uuid;
 return v_order;
end; $$;
revoke all on function public.create_order_intent_with_terms(uuid,jsonb,jsonb,jsonb,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_order_intent_with_terms(uuid,jsonb,jsonb,jsonb,text,text,text,text,text) to service_role;

-- Only a checkout that has never reached Stripe can be released immediately.
create function public.expire_unstarted_checkout(p_order_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_order public.orders%rowtype;
begin
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.status <> 'awaiting_payment' or coalesce(v_order.paid_cents,0)>0
  or v_order.stripe_checkout_expires_at is not null
  or exists(select 1 from public.payments where order_id=p_order_id) then return false; end if;
 update public.orders set expires_at=now()-interval '1 second' where id=p_order_id;
 return private.expire_unpaid_order_reservation(p_order_id);
end; $$;
revoke all on function public.expire_unstarted_checkout(uuid) from public,anon,authenticated;
grant execute on function public.expire_unstarted_checkout(uuid) to service_role;

create table private.user_platform_terms_acceptances(user_id uuid not null,terms_version text not null,terms_snapshot text not null,accepted_at timestamptz not null default now());
alter table private.user_platform_terms_acceptances enable row level security;
revoke all on private.user_platform_terms_acceptances from public,anon,authenticated,service_role;
grant select on private.user_platform_terms_acceptances to service_role;
create function private.record_signup_terms() returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if new.raw_user_meta_data->>'platform_terms_version'='2026-10-01' and new.raw_user_meta_data->>'platform_terms_accepted'='true' then
 insert into private.user_platform_terms_acceptances(user_id,terms_version,terms_snapshot)
 select new.id,version,body from private.legal_document_versions where document_key='platform_terms' and version='2026-10-01';
 if not found then raise exception 'PLATFORM_AGREEMENTS_UNAVAILABLE'; end if;
 end if;
 return new;
end; $$;
create trigger record_signup_terms after insert on auth.users for each row execute function private.record_signup_terms();

create or replace function public.get_public_organization_sales_terms(
  p_org_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_slug text := nullif(trim(coalesce(p_org_slug, '')), '');
  v_result jsonb;
begin
  if v_slug is null then
    raise exception 'VALIDATION_ERROR: org_slug is required';
  end if;

  perform public.assert_rate_limit(
    'anon:org_sales_terms:' || v_slug,
    240,
    60
  );

  select jsonb_build_object(
    'seller_legal_name', op.seller_legal_name,
    'seller_address', op.seller_address,
    'seller_business_number', op.seller_business_number,
    'seller_type', op.seller_type,
    'connect_terms_accepted_version', op.connect_terms_accepted_version,
    'dpa_accepted_version', op.dpa_accepted_version,
    'display_name', op.display_name,
    'public_email', op.public_email,
    'phone', op.phone,
    'website', op.website,
    'sales_terms', op.sales_terms,
    'sales_terms_version', op.sales_terms_version,
    'sales_terms_accepted', coalesce(
      op.sales_terms_accepted_at is not null
      and op.connect_terms_accepted_version = '2026-10-01'
      and op.dpa_accepted_version = '2026-10-01'
      and op.platform_terms_accepted_version = '2026-10-01'
      and op.privacy_accepted_version = '2026-10-01'
      and char_length(trim(coalesce(op.seller_legal_name,''))) >= 2
      and char_length(trim(coalesce(op.seller_address,''))) >= 8
      and char_length(trim(coalesce(op.phone,''))) >= 6
      and op.seller_type is not null
      and op.sales_terms_accepted_version = op.sales_terms_version
      and nullif(trim(coalesce(op.public_email, '')), '') is not null
      and trim(op.public_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$', false),
    'paid_sales_available', coalesce(
      o.status = 'active'
      and o.payments_provider = 'stripe'
      and owner_profile.stripe_connect_allowed = true
      and o.stripe_connected_account_id is not null
      and o.stripe_compliance_verified = true
      and o.stripe_details_submitted = true
      and o.stripe_charges_enabled = true
      and o.stripe_payouts_enabled = true
      and o.stripe_requirements_disabled_reason is null
      and jsonb_array_length(o.stripe_requirements_currently_due) = 0, false)
  )
  into v_result
  from public.organization_profile op
  join public.organizations o on o.id = op.org_id
  left join public.user_profile owner_profile on owner_profile.user_id = o.created_by
  where op.slug = v_slug
  limit 1;

  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_public_organization_sales_terms(text)
  from public, anon, authenticated;
grant execute on function public.get_public_organization_sales_terms(text)
  to anon, authenticated;


-- New organizations only: custom and existing defaults remain untouched.
alter table public.organization_profile alter column sales_terms set default $sales$# Conditions de réservation et de vente

## Identité du vendeur

Le vendeur des billets et l’organisateur de l’événement est l’organisation identifiée sur la page de l’événement. Eventflow fournit la plateforme technique et n’est pas le vendeur.

## Réservation et paiement

La réservation payante devient définitive après confirmation du paiement. Le paiement est encaissé directement par l’organisateur au moyen de son compte Stripe connecté.

Le prix total, les éventuels frais et le montant payable immédiatement sont affichés avant validation. Lorsqu’un acompte est proposé, l’organisateur indique le solde, son échéance et ses modalités de paiement dans les informations de l’événement avant la commande. Aucune somme supplémentaire non annoncée ne peut être exigée.

## Livraison et accès aux billets

Les billets électroniques sont délivrés après confirmation du paiement ou de l’inscription gratuite, par e-mail et sur la page de confirmation de la commande. En cas de non-réception, le participant vérifie ses courriers indésirables et contacte l’organisateur. Les conditions d’accès, restrictions d’âge, horaires et prestations incluses sont indiqués sur la page de l’événement avant la réservation.

## Droit de rétractation

Pour une activité de loisirs fournie à une date ou pendant une période déterminée, le droit légal de rétractation de quatorze jours ne s’applique pas lorsque l’exception légale est applicable. Cette absence de rétractation ne supprime pas les droits du participant en cas d’annulation de l’événement ou de prestation non conforme. Pour une prestation ne relevant pas de cette exception, l’organisateur fournit avant la commande les informations et modalités du droit de rétractation applicable.

## Annulation par le participant

Toute demande d’annulation ou de remboursement doit être adressée directement à l’organisateur au moyen des coordonnées affichées sur la page de l’événement. Un remboursement n’est accordé que lorsque l’organisateur l’accepte ou lorsque la législation applicable l’impose.

## Annulation ou modification par l’organisateur

Si l’événement est annulé, l’organisateur informe les participants par les coordonnées de commande et leur communique la procédure et le délai de remboursement des prestations non fournies. En cas de report ou de modification substantielle, il précise les nouvelles modalités et les solutions proposées, dans le respect des droits légaux du participant. Une demande peut toujours être adressée au contact public de l’organisateur ; aucun avoir ou report ne peut être imposé en remplacement d’un remboursement lorsque la loi exige celui-ci.

## Billets

Le participant est responsable de la conservation de son billet et de son code d’accès. Un billet remboursé, annulé, déjà utilisé ou rendu invalide ne permet plus l’accès à l’événement.

## Contact

Les questions concernant l’événement, l’accès, une annulation ou un remboursement doivent être adressées à l’organisateur via ses coordonnées publiques, en mentionnant la référence de commande. L’organisateur accuse réception et apporte une réponse dans un délai raisonnable. Ces conditions ne limitent pas les recours ni les protections impératives applicables au participant.

## Données personnelles

L’organisateur utilise les données nécessaires à la réservation, à la communication relative à l’événement et au contrôle d’accès. Il est responsable de ces traitements et fournit son information sur la protection des données. Eventflow traite ces données pour son compte afin de fournir le service. Aucune inscription à une prospection facultative ne découle de la seule acceptation de ces conditions.$sales$;
alter table public.organization_profile alter column sales_terms_version set default 'default-2026-10-01';

-- Immutable published documents; acceptance RPCs copy these trusted bodies.
insert into private.legal_document_versions(document_key,version,body) values ('platform_terms','2026-10-01',$document$Conditions générales d’utilisation d’Eventflow
Version du 1er octobre 2026

1. Éditeur et objet
Eventflow est édité par Nicolas Manns, entrepreneur individuel, Rue Féral 43, 5190 Jemeppe-sur-Sambre, Belgique, numéro d’entreprise et TVA BE0840.386.125. Contact : contact@useeventflow.eu — +32 495 78 67 96.
Eventflow fournit un logiciel de création et gestion d’événements, d’inscriptions, de billetterie et de suivi des participants. Les présentes conditions régissent l’accès au logiciel. Les conditions de vente de chaque organisateur régissent séparément les billets et prestations qu’il propose.

2. Compte et représentation
L’utilisateur fournit des informations exactes, maintient ses coordonnées à jour et protège ses identifiants. Il signale sans délai tout accès non autorisé. La personne qui engage une organisation déclare disposer des pouvoirs nécessaires. Les membres n’accèdent qu’aux organisations et fonctionnalités autorisées ; le responsable de l’organisation gère leurs habilitations.
L’acceptation des conditions est recueillie dans l’interface. La publication d’une nouvelle version ne constitue pas, à elle seule, une acceptation rétroactive.

3. Rôle de l’organisateur
L’organisateur est le vendeur des billets et prestations, responsable de leur légalité, des autorisations nécessaires, de l’exécution de l’événement, de sa capacité d’accueil, de sa fiscalité et des informations données aux participants. Il fournit son identité juridique et ses coordonnées, des descriptions et prix exacts, ainsi que ses conditions de vente, de livraison, d’annulation, de report, de remboursement et de rétractation lorsque applicable. Il traite les réclamations et respecte les droits impératifs des consommateurs.
Eventflow n’est pas l’organisateur de l’événement et ne devient pas le vendeur du billet par la fourniture du logiciel. Cette répartition ne supprime aucune obligation propre à Eventflow.

4. Paiements de billetterie et Stripe Connect
Les paiements en ligne initiés via Eventflow sont traités par Stripe sur le compte connecté de l’organisateur. L’organisateur souscrit aux conditions Stripe applicables et fournit à Stripe les informations nécessaires à sa vérification. Stripe décide de l’activation, du maintien et des restrictions de ses services ; Eventflow conserve ses propres obligations légales et contractuelles.
Le parcours de billetterie Eventflow est destiné aux paiements uniques en euros par Bancontact. L’organisateur ne doit pas modifier sa configuration pour contourner les moyens autorisés par Eventflow. Les fonds des billets ne sont pas centralisés puis redistribués par Eventflow. Les frais, délais et éventuelles réserves Stripe relèvent des conditions applicables au compte de l’organisateur.
L’annexe « Conditions de connexion Stripe Connect », accessible à /conditions-connect, décrit les données consultées et opérations autorisées. Elle doit être acceptée par un représentant habilité avant utilisation des fonctionnalités concernées. Les remboursements restent possibles et leurs conditions doivent être indiquées aux acheteurs.

5. Abonnement au logiciel
L’accès au logiciel peut être gratuit ou payant selon l’offre choisie. Les prix, limites, période de facturation et éventuelles conditions particulières sont présentés avant l’engagement. Les abonnements Eventflow sont facturés séparément de la billetterie et réglés par virement bancaire ; ils ne sont pas prélevés sur les ventes de billets via Stripe.
La durée, le renouvellement et les échéances applicables sont ceux de l’offre expressément acceptée. Une reconduction ou un engagement annuel ne peut être déduit du seul usage du service. Toute demande de résiliation peut être adressée à contact@useeventflow.eu ; Eventflow confirme sa date d’effet et les montants restant dus selon l’offre acceptée. Une résiliation ne prive pas l’utilisateur des droits impératifs qui lui sont applicables. Toute modification tarifaire s’applique à une période future après information préalable, dans le respect de l’engagement en cours.

6. Utilisations interdites et contrôle
Il est interdit d’utiliser Eventflow à des fins illégales, frauduleuses ou trompeuses, de porter atteinte aux droits de tiers, de compromettre la sécurité ou de contourner une restriction de compte. Les ventes doivent également respecter les restrictions Stripe : https://stripe.com/en-be/legal/restricted-businesses. Une activité soumise à autorisation préalable ne peut être activée sans celle-ci.
Eventflow peut demander les informations utiles à la vérification de l’activité et suspendre les fonctionnalités concernées en cas de fraude, risque sérieux, violation contractuelle ou exigence légale ou du prestataire de paiement. L’organisateur coopère au traitement des signalements et conserve les justificatifs de ses ventes et remboursements.

7. Disponibilité et services tiers
Eventflow met en œuvre des moyens raisonnables pour assurer le fonctionnement et la sécurité du service. Des interruptions peuvent résulter de maintenance, incidents, réseaux ou fournisseurs tiers, sans garantie de disponibilité continue. Eventflow s’efforce d’en limiter la durée et les conséquences. Les conditions propres des fournisseurs s’appliquent à leurs services.

8. Données et confidentialité
La politique de confidentialité décrit les traitements propres d’Eventflow. Pour les données de participants traitées pour le compte de l’organisateur, l’accord de traitement des données accessible à /accord-traitement-donnees fait partie de la relation contractuelle. L’organisateur détermine les finalités, les données nécessaires et la durée de conservation, informe les personnes et dispose d’une base juridique appropriée. Il évite de collecter des données sensibles inutiles.

9. Propriété intellectuelle
La plateforme, son code, ses interfaces et éléments graphiques sont protégés. Aucun droit de propriété n’est transféré à l’utilisateur. Celui-ci conserve ses droits sur les contenus fournis et autorise leur hébergement, reproduction et affichage dans la seule mesure nécessaire à la fourniture du service. Il garantit disposer des droits nécessaires.

10. Responsabilité
Eventflow répond de ses propres obligations dans les limites prévues par la loi. Il n’est pas garant de l’exécution d’un événement ni de la solvabilité de l’organisateur. Les actes de tiers qui échappent raisonnablement à son contrôle n’engagent pas automatiquement sa responsabilité. Aucune clause n’exclut ou ne limite une responsabilité qui ne peut légalement l’être, ni les droits impératifs des utilisateurs.

11. Suspension, fermeture et données
L’utilisateur peut demander la fermeture de son compte à contact@useeventflow.eu. Une fermeture n’annule pas les commandes, les remboursements dus ni les obligations de conservation légales. Avant fermeture, l’organisateur doit organiser l’export ou la restitution des données nécessaires ; les modalités de suppression sont précisées dans l’accord de traitement.
Toute restriction ou résiliation décidée par Eventflow est motivée et notifiée sur un support durable, avec possibilité de contacter le support pour obtenir des explications ou contester la mesure, sauf interdiction légale. Les préavis et exceptions impératifs sont respectés ; lorsqu’un préavis de trente jours est légalement requis pour une résiliation, il est appliqué. Une mesure immédiate peut être nécessaire en cas d’obligation légale, fraude ou menace sérieuse pour la sécurité.

12. Modification des conditions
Les modifications sont communiquées sur un support durable avant leur entrée en vigueur avec un préavis d’au moins quinze jours, et plus long si une adaptation technique ou commerciale le nécessite, sous réserve des exceptions légales. L’utilisateur peut résilier avant leur entrée en vigueur. Les changements urgents imposés par la loi ou nécessaires contre un danger imprévu et imminent peuvent être appliqués sans ce préavis dans les limites légales. La version acceptée est conservée comme preuve.

13. Contact, droit et litiges
Les demandes et signalements de contenus ou événements illicites peuvent être envoyés à contact@useeventflow.eu, avec l’URL concernée et les éléments permettant de les examiner. Les parties recherchent une solution amiable. Le droit belge s’applique. Pour les utilisateurs professionnels, les tribunaux du ressort du siège de l’éditeur sont compétents, sous réserve des règles impératives. Les droits et compétences juridictionnelles impératifs des consommateurs sont préservés.$document$);
insert into private.legal_document_versions(document_key,version,body) values ('privacy','2026-10-01',$document$Politique de confidentialité
Version du 1er octobre 2026

1. Responsables et contact
Nicolas Manns, entrepreneur individuel exploitant Eventflow, Rue Féral 43, 5190 Jemeppe-sur-Sambre, Belgique, BE0840.386.125, est responsable des traitements liés à la gestion de ses utilisateurs, de sa relation commerciale et à la sécurité de son service. Contact : contact@useeventflow.eu — +32 495 78 67 96.
L’organisateur est responsable des données des acheteurs et participants traitées pour organiser ses événements. Eventflow intervient pour son compte comme sous-traitant pour l’hébergement, les inscriptions, commandes, billets et communications correspondantes. L’organisateur doit fournir sa propre information de confidentialité, notamment pour les champs qu’il ajoute à ses formulaires. Stripe détermine également certains traitements propres à ses services de paiement et à ses obligations légales : https://stripe.com/fr-be/privacy.

2. Données, finalités et bases juridiques
Les données de compte, coordonnées, organisation, habilitations et échanges de support servent à créer et administrer l’accès et à exécuter le contrat. Les données de facturation, paiement de l’abonnement et pièces comptables servent à gérer la relation commerciale et respecter les obligations légales.
Les journaux techniques, adresses IP et informations de navigateur ou d’appareil peuvent être utilisés pour sécuriser les accès, prévenir les abus et diagnostiquer les incidents, sur la base de l’intérêt légitime à protéger le service et ses utilisateurs. Ils ne sont pas présentés comme systématiquement anonymes.
Les confirmations contractuelles et leurs versions sont conservées pour prouver les accords, gérer les réclamations et défendre les droits, au titre de l’exécution du contrat et de l’intérêt légitime à établir cette preuve.
Pour les événements, les données comprennent les coordonnées de l’acheteur et des participants, réponses aux formulaires, commandes, billets et statuts de paiement. Les données obligatoires sont signalées dans les formulaires ; leur absence peut empêcher l’inscription ou l’achat. L’organisateur détermine la base juridique de ses traitements.
Pour un paiement, Eventflow transmet à Stripe les informations nécessaires telles que montant, devise, référence de commande et adresse e-mail, puis reçoit les identifiants et statuts utiles au suivi. Les informations complètes d’authentification bancaire ne sont pas stockées par Eventflow.

3. Destinataires et prestataires
Les données ne sont pas vendues. Elles sont accessibles aux personnes habilitées d’Eventflow, à l’organisateur concerné et à ses membres autorisés, aux prestataires nécessaires et, lorsque la loi l’impose, aux autorités compétentes.
Les services utilisés comprennent Supabase (base de données, authentification et stockage), Netlify (hébergement et diffusion du site et de l’application), Resend (e-mails transactionnels), Cloudflare Turnstile (protection contre les abus), Stripe (paiements et connexion des organisateurs) et Billit (facturation Eventflow). Les données transmises dépendent du service réellement utilisé ; Billit n’est pas destinataire de toutes les données de participants.

4. Transferts internationaux
Certains prestataires peuvent traiter des données en dehors de l’Espace économique européen. Eventflow doit encadrer ces transferts par un mécanisme applicable, tel qu’une décision d’adéquation ou les clauses contractuelles types et, si nécessaire, des mesures complémentaires. Les informations sur les prestataires, destinations et garanties applicables au traitement concerné peuvent être demandées à contact@useeventflow.eu. Le recours à un fournisseur étranger ne signifie pas que toutes les données sont transférées dans chaque pays où il opère.

5. Conservation
Les données de compte sont conservées pendant la relation de service puis supprimées ou anonymisées lorsqu’elles ne sont plus nécessaires. Les éléments nécessaires aux obligations comptables et fiscales, à la preuve des contrats, au traitement des litiges et à la défense des droits peuvent être conservés séparément pendant les délais légaux ou de prescription applicables.
Les données des événements sont conservées selon les instructions documentées de l’organisateur et les nécessités de la prestation. Celui-ci peut demander une restitution ou suppression à Eventflow ; aucune fonction automatique de paramétrage de durée n’est présumée. Les journaux et sauvegardes sont soumis à des durées proportionnées à leur finalité de sécurité et de reprise ; leur effacement suit leur cycle de rotation. Pour connaître la durée applicable à une catégorie précise ou demander une suppression, contactez Eventflow.

6. Sécurité et stockage navigateur
Eventflow met en œuvre des mesures techniques et organisationnelles adaptées au risque, notamment la gestion des accès et la séparation des organisations. Aucun système ne peut garantir une sécurité absolue.
Les éléments de stockage nécessaires à l’authentification, au fonctionnement et à la sécurité peuvent être utilisés. Les traceurs non nécessaires, lorsqu’ils sont proposés, ne doivent être activés qu’après le consentement requis et doivent pouvoir être refusés ou désactivés. La prise de connaissance de cette politique n’est pas un consentement global à tous les traitements.

7. Droits et réclamations
Selon les conditions légales, vous pouvez demander l’accès, la rectification, l’effacement, la limitation et la portabilité de vos données, et vous opposer aux traitements fondés sur l’intérêt légitime. Lorsqu’un traitement repose sur le consentement, vous pouvez le retirer à tout moment sans affecter la licéité du traitement antérieur.
Adressez vos demandes concernant Eventflow à contact@useeventflow.eu. Pour les données d’un événement, contactez en priorité l’organisateur indiqué lors de l’inscription ; Eventflow peut l’assister et lui transmettre votre demande. Une vérification proportionnée de l’identité peut être nécessaire. Les demandes sont traitées dans les délais du RGPD.
Vous pouvez introduire une réclamation auprès de l’Autorité de protection des données belge : https://www.autoriteprotectiondonnees.be — Rue de la Presse 35, 1000 Bruxelles.

8. Évolution
Cette politique peut être mise à jour pour refléter les traitements. Les changements significatifs sont portés à la connaissance des utilisateurs. La version présentée lors d’une confirmation est conservée comme preuve de l’information fournie.$document$);
insert into private.legal_document_versions(document_key,version,body) values ('connect','2026-10-01',$document$Conditions de connexion Stripe Connect
Version du 1er octobre 2026

1. Parties et portée
Cette annexe complète les CGU Eventflow entre Nicolas Manns, exploitant Eventflow, et l’organisateur qui la valide par un représentant habilité. Elle s’applique aux paiements de billets et prestations de l’organisateur via son compte Stripe Connect Standard. Elle ne remplace pas les accords que l’organisateur conclut directement avec Stripe.

2. Vendeur, vérification et configuration
L’organisateur demeure le vendeur, tient à jour son identité, son compte bancaire, ses justificatifs et ses conditions de vente, et répond aux demandes de Stripe. Il respecte les activités interdites ou restreintes de Stripe et les moyens de paiement autorisés par Eventflow. Les paiements initiés via Eventflow sont destinés à être uniques, en EUR et par Bancontact. L’activation technique ne vaut pas validation juridique des événements proposés.
Les paiements sont créés directement sur le compte connecté ; Eventflow ne centralise ni ne redistribue les recettes. Stripe décide des capacités, versements, réserves et restrictions selon ses accords. Eventflow ne garantit ni l’acceptation ni le maintien d’un compte Stripe.

3. Données et opérations expressément autorisées
L’organisateur autorise Eventflow, dans la mesure nécessaire à la billetterie, à initier la connexion et l’onboarding, consulter l’identifiant, le statut, les capacités, les exigences de vérification et de configuration de son compte, et recevoir les notifications Stripe correspondantes.
Il autorise la création de sessions de paiement à partir des commandes, la transmission des montants, devises, références et données de contact nécessaires, la consultation des identifiants et statuts de paiement et de remboursement, et leur rapprochement avec les commandes et billets.
Il autorise l’exécution des remboursements demandés par un membre habilité de son organisation via les fonctionnalités disponibles. Il autorise également le remboursement automatique d’un paiement reçu après expiration ou annulation de la commande lorsqu’elle ne peut plus être honorée par le parcours Eventflow. Ces opérations sont répercutées sur son compte Stripe ; leur disponibilité, leurs délais et frais éventuels restent régis par Stripe. L’organisateur conserve la responsabilité de fournir les fonds nécessaires et de respecter ses obligations envers l’acheteur.
Cette autorisation ne permet pas à Eventflow de créer un prélèvement d’abonnement SaaS ni d’utiliser les données pour des finalités étrangères au service. Les données sont accessibles aux personnes et prestataires habilités selon la politique de confidentialité et l’accord de traitement des données.

4. Coopération et réclamations
L’organisateur assure la livraison des billets, l’exécution des prestations, les informations de remboursement et le support aux acheteurs. Il répond aux demandes de justificatifs utiles au traitement d’un incident et informe Eventflow d’une utilisation non autorisée. Eventflow assure le support technique de son intégration et reste responsable de ses propres obligations.

5. Retrait de l’autorisation et fin de connexion
L’organisateur peut déconnecter Eventflow depuis Stripe ou demander son assistance à contact@useeventflow.eu. La déconnexion empêche de nouveaux paiements et peut empêcher le suivi ou les remboursements via Eventflow. Elle n’efface pas les ventes passées, les droits des acheteurs ou les obligations légales. L’organisateur doit alors gérer les opérations restantes directement dans Stripe. Les données déjà nécessaires à la preuve, à la comptabilité ou aux litiges sont conservées uniquement pendant la durée justifiée.
Les évolutions de cette annexe sont soumises aux règles de notification des CGU. La version et les confirmations du représentant sont enregistrées lors de l’acceptation.$document$);
insert into private.legal_document_versions(document_key,version,body) values ('dpa','2026-10-01',$document$Accord de traitement des données
Version du 1er octobre 2026

1. Parties, objet et durée
Cet accord complète les CGU entre l’organisateur, responsable du traitement, et Nicolas Manns exploitant Eventflow, sous-traitant. Il s’applique pendant la fourniture du service et jusqu’à restitution ou suppression des données traitées pour le compte de l’organisateur. Il ne couvre pas les traitements dont Eventflow ou Stripe déterminent eux-mêmes les finalités pour leurs obligations propres, décrits dans leurs politiques de confidentialité.

2. Traitements confiés
Le service comprend la collecte, l’enregistrement, l’hébergement, la consultation, la mise à jour, l’export, la transmission et la suppression nécessaires aux événements, inscriptions, commandes, billets, contrôles d’accès, notifications et suivi des paiements. Les personnes concernées sont les acheteurs, participants, contacts et membres habilités de l’organisation.
Les données concernées sont les identités et coordonnées, réponses aux formulaires configurés par l’organisateur, références de commande, billets, statuts de paiement et informations techniques nécessaires. L’organisateur limite la collecte aux données utiles ; il ne doit pas demander de données sensibles sans nécessité, base juridique et mesures appropriées préalablement convenues.

3. Instructions et confidentialité
Eventflow traite les données uniquement sur les instructions documentées de l’organisateur, constituées par cet accord, ses réglages et demandes écrites, y compris en matière de transferts internationaux. Si une obligation légale impose un autre traitement, Eventflow en informe préalablement l’organisateur, sauf interdiction légale. Eventflow l’informe immédiatement s’il estime qu’une instruction enfreint le droit de la protection des données.
Les personnes autorisées à traiter les données sont soumises à une obligation de confidentialité et n’y accèdent que dans la mesure nécessaire à leurs fonctions.

4. Sécurité
Eventflow met en œuvre les mesures techniques et organisationnelles appropriées au risque conformément à l’article 32 du RGPD : contrôle des accès et habilitations, séparation des organisations, protection des échanges, gestion des secrets, journalisation utile à la sécurité et procédures de traitement des incidents. Il évalue et adapte ces mesures selon la nature des données et du service. Les informations nécessaires à leur évaluation sont disponibles sur demande, sans divulgation de secrets compromettant la sécurité.

5. Sous-traitants ultérieurs et transferts
L’organisateur autorise généralement le recours aux sous-traitants techniques nécessaires, notamment Supabase (authentification, base et stockage), Netlify (hébergement), Resend (e-mails transactionnels) et Cloudflare (protection contre les abus), dans la mesure où ils traitent ses données. Stripe intervient selon les rôles définis par ses accords de paiement ; Billit sert à la facturation propre d’Eventflow.
Eventflow impose aux sous-traitants ultérieurs des obligations de protection équivalentes à celles du présent accord et demeure responsable de leur exécution envers l’organisateur. Il informe préalablement l’organisateur de tout ajout ou remplacement, lui permettant de présenter une objection motivée relative à la protection des données. Les parties recherchent une solution ; si aucune solution appropriée n’est possible avant le changement, l’organisateur peut mettre fin à la fonctionnalité ou au service concerné et demander la restitution de ses données.
Les transferts hors EEE doivent être encadrés par les garanties requises au chapitre V du RGPD. Eventflow fournit sur demande les informations relatives aux prestataires, localisations et mécanismes applicables.

6. Assistance et violations
Compte tenu de la nature du traitement et des informations dont il dispose, Eventflow aide l’organisateur à répondre aux demandes d’exercice des droits, à assurer la sécurité et à remplir ses obligations concernant les violations, analyses d’impact et consultations préalables. Il lui transmet les demandes reçues concernant ses participants et ne décide pas seul d’y donner suite hors instruction ou obligation légale.
Eventflow notifie à l’organisateur toute violation de données personnelles sans délai indu après en avoir pris connaissance. Il communique les informations disponibles sur la nature, les personnes et données concernées, les conséquences probables et les mesures prises ou proposées, et les complète au fur et à mesure. L’organisateur reste responsable des notifications à l’autorité et aux personnes lorsque requises.

7. Restitution et suppression
À la fin de la prestation, Eventflow restitue ou supprime les données et copies selon le choix documenté de l’organisateur, sauf obligation légale de conservation. L’organisateur formule son choix et organise ses exports avant fermeture ; une demande peut être adressée à contact@useeventflow.eu. Les copies de sauvegarde qui ne peuvent être effacées individuellement restent protégées, sans utilisation active, jusqu’à leur effacement par rotation. En cas de restauration, les instructions de suppression sont réappliquées. Aucune durée de sauvegarde particulière n’est garantie par le présent accord.

8. Documentation et contrôle
Eventflow met à disposition les informations nécessaires pour démontrer le respect de cet accord et permet les audits, y compris inspections, par l’organisateur ou un auditeur indépendant mandaté, et y contribue. Les modalités sont organisées avec un préavis raisonnable, sous confidentialité et sans compromettre les données d’autres clients ; ces modalités ne peuvent faire obstacle aux contrôles nécessaires ni aux pouvoirs des autorités. Les parties coopèrent à la correction des écarts constatés.
L’organisateur reste responsable de la licéité de ses instructions, de l’information des personnes et de ses obligations de responsable du traitement. Les droits impératifs des personnes et les responsabilités fixées par le RGPD restent intégralement préservés.$document$);

commit;
