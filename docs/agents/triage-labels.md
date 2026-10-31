# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

All five use the default vocabulary: every label string equals its role name.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Wayfinder labels

Used by `/wayfinder` only. These are not triage roles and are not applied by `/triage`.

| Label               | Meaning                                        |
| ------------------- | ---------------------------------------------- |
| `wayfinder:map`     | The map: destination, notes, decisions, fog    |
| `wayfinder:research`| Ticket type: research                          |
| `wayfinder:prototype`| Ticket type: prototype                        |
| `wayfinder:grilling`| Ticket type: grilling                          |
| `wayfinder:task`    | Ticket type: task                              |

## Not enforced

Labels outside the vocabulary above are **not** required or auto-applied. Skills apply a label only when their own rules call for it; nothing here forces an extra label onto an issue.
