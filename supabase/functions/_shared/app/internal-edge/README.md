# Internal Edge calls

This Eventflow adapter combines generic worker authentication with internal JSON
calls. New calls use `Authorization: Bearer`; `x-service-token` remains accepted
only as an explicit transition for remote consumers not migrated yet.

Remove legacy acceptance after the production reminder cron has migrated.
