# iCloud Reminders Integration

## Goal

Connect Abbai Flow directly to Apple Reminders, starting with lists, reminders,
sections, completion state, and moving reminders between sections. Calendar
support is a later phase.

## Reminder data model

Represent a reminder list as a collection of sections and reminders. Preserve
Apple identifiers and all reminder fields returned by the provider. Keep
reminder-to-section membership separate from reminder properties. A
reverse-engineered example from the local Reminders store has list-level
membership entries linking a reminder UUID (`memberID`) to a section UUID
(`groupID`). This local database example does not establish the exact shape of
Apple's server response. A reminder without an entry is unsectioned.

Moving a reminder changes its membership entry while preserving the reminder
ID and all of its other data. Moving it to the unsectioned area removes that
entry. For duplicate entries, the newest `modifiedOn` value is authoritative.

## Integration and sync

Keep the integration server-side; do not require a separate Mac bridge. Store
iCloud connection settings through the existing server-backed Integrations
settings and never return the saved password to the browser. The PyICloud
worker runs as a persistent Python process so a 2FA challenge can continue
between settings requests. Its preview shows a bounded sample of decoded Apple
records for inspection; it does not log the response or write reminders.

Apple does not publish a Reminders web API schema. A developer's CloudKit
container is separate from Apple's Reminders container, so a CloudKit API key
for an Abbai Flow container cannot grant access to Reminders. The server-side
probe must inspect the authenticated iCloud Reminders service directly and
verify whether it exposes section records and membership data. PyICloud's
documented Reminders API exposes lists, reminders, and related metadata, but
does not document sections. The live write path must confirm section moves
through a fresh read. Do not silently report success if Apple does not return
the moved reminder in its new section.

## Implementation sequence

1. Add the server-side PyICloud dependency, credential settings, and persistent
   worker for Apple authentication and verification.
2. Fetch a small decoded response sample and inspect whether list/reminder
   records expose sections and membership data.
3. Keep the section membership model and move transformation only if they match
   the live response; then validate a live read-after-write before exposing
   reminder mutations.
4. Add section-aware list views and move controls, including the unsectioned
   area.
5. Add calendar credential settings for multiple sources; implement event
   reads and writes in a later phase.

## Current scope

Phase 1 adds server-side iCloud credentials, authentication/verification, and a
fetch preview for investigating Apple's decoded reminder data. It does not yet
sync reminders into Abbai Flow, expose writes, or claim section support. A local
section membership model has been sketched but remains unconnected pending the
live response probe.

Calendar settings can hold multiple named CalDAV, ICS-feed, and Google
credential configurations. Calendar reads, event creation, sync, and weather
integration remain out of scope until the reminders probe is validated.
