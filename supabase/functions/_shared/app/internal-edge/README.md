# Internal Edge calls

This Eventflow adapter combines generic worker authentication with internal JSON
calls. New calls use `Authorization: Bearer`; `x-service-token` is sent and
accepted only as an explicit transition for consumers not migrated yet.

Remove the legacy header after `send-reminder-mail` and its scheduled caller
have migrated.
