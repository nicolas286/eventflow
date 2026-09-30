-- Cover private communication foreign keys used for deletes and audit filters.
create index platform_email_campaigns_actor_idx
  on private.platform_email_campaigns (actor_user_id);
create index platform_email_campaigns_organization_idx
  on private.platform_email_campaigns (organization_id)
  where organization_id is not null;
create index platform_email_deliveries_organization_idx
  on private.platform_email_deliveries (organization_id);
create index platform_email_deliveries_recipient_user_idx
  on private.platform_email_deliveries (recipient_user_id)
  where recipient_user_id is not null;
