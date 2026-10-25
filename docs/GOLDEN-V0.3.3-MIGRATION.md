# Golden scenario migration ledger

Baseline: 175f2d58 (v0.3.1-extended.11). Candidate: v0.3.3-extended.1. Upstream: f07b8965 (v0.3.3).

All 288 changed or added default-version scenarios are named. 272 outputs exactly match upstream; 16 retained collaboration scenarios differ from upstream because upstream does not carry those local operators. Historical corpora are new upstream version fixtures.

| Family | Scenario | Change | Reason |
| --- | --- | --- | --- |
| bonds | `bond-arcaneShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-arcaneShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-deputShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, ticks, time, units |
| bonds | `bond-deputShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| bonds | `bond-egirShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, snaps, ticks, time, units |
| bonds | `bond-egirShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-emptyShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| bonds | `bond-emptyShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-indomShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| bonds | `bond-indomShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-investShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, players, snaps, ticks, time, units |
| bonds | `bond-investShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-kazimierzShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| bonds | `bond-kazimierzShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-kjeragShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-kjeragShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-lateranoShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-lateranoShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-maniShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| bonds | `bond-maniShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-miraShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-miraShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-preciShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-preciShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| bonds | `bond-raidShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| bonds | `bond-raidShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| bonds | `bond-sargonShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| bonds | `bond-sargonShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-siracusaShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| bonds | `bond-siracusaShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-skillfulShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-skillfulShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, snaps, ticks, time, units |
| bonds | `bond-soloShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| bonds | `bond-soloShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-steadShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-steadShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-suntShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, snaps, units |
| bonds | `bond-suntShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| bonds | `bond-swiftShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-swiftShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, fx, hooks, players, rngDraws, snaps, units |
| bonds | `bond-victoriaShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-victoriaShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| bonds | `bond-visiShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-visiShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-yanShip-high` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| bonds | `bond-yanShip-low` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-001` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-002` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-004` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-005` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, units |
| diy | `diy-006` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, players, snaps, units |
| diy | `diy-007` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-008` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-009` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-010` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, snaps |
| diy | `diy-011` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-013` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-014` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-015` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-016` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-017` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-018` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-019` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-020` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-021` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-022` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-024` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-025` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-026` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, ticks, time, units |
| diy | `diy-027` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-029` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| diy | `diy-030` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| diy | `diy-031` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-032` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-033` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, ticks, time, units |
| diy | `diy-034` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-035` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, reason, rngDraws, snaps, ticks, time, units |
| diy | `diy-036` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-037` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-038` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, reason, snaps, ticks, time, units |
| diy | `diy-039` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-040` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-041` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-042` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-043` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-044` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-045` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-046` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-047` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-048` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-049` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-050` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-051` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| diy | `diy-052` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, snaps, units |
| diy | `diy-053` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-054` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-055` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-056` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-057` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| diy | `diy-058` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| diy | `diy-059` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, snaps, units |
| diy | `diy-060` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-061` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-063` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-064` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-065` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-066` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-068` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-069` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-070` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-071` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-072` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| diy | `diy-073` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, snaps, ticks, time, units |
| diy | `diy-074` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-075` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-076` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-077` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-078` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-079` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-080` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-081` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-082` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-083` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: hooks, snaps |
| diy | `diy-084` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-086` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, fx, hooks, snaps, ticks, time, units |
| diy | `diy-087` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-088` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-089` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-090` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-091` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-092` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| diy | `diy-093` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-094` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-095` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-096` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-097` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-098` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-099` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-100` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-101` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-102` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, reason, snaps, ticks, time, units |
| diy | `diy-103` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-104` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-105` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-106` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-107` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| diy | `diy-108` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, snaps, units |
| diy | `diy-109` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-110` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-111` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: hooks, snaps |
| diy | `diy-114` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, snaps, ticks, time, units |
| diy | `diy-115` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-116` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-117` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-118` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, units |
| diy | `diy-119` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-120` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-121` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-123` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, fx, snaps |
| diy | `diy-124` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, units |
| diy | `diy-125` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-126` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-127` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-128` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-129` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-130` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-131` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, units |
| diy | `diy-132` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-134` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| diy | `diy-135` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| diy | `diy-136` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->133 |
| diy | `diy-137` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->356 |
| diy | `diy-138` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->20 |
| diy | `diy-139` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->7 |
| diy | `diy-140` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->4 |
| diy | `diy-141` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->170 |
| diy | `diy-142` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->3 |
| diy | `diy-143` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->7 |
| diy | `diy-144` | updated | Marcil scenario inherits upstream ordered damage settlement: damaged hook counts now cover every damage instance; snapshot state follows. Unit/enemy aggregates unchanged. |
| diy | `diy-145` | updated | Oblvns scenario inherits upstream ordered damage settlement: damaged hook counts and rate event tracing change; snapshots follow. Unit/enemy aggregates unchanged. |
| diy | `diy-146` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->149 |
| diy | `diy-147` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->148 |
| diy | `diy-148` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->229 |
| diy | `diy-149` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->20 |
| diy | `diy-150` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->62 |
| diy | `diy-151` | updated | Retained local collaboration scenario; upstream event stream shape/count changes: rate:None->23 |
| fields | `boss-boss_1-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_1-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_2-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, snaps, units |
| fields | `boss-boss_2-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_3-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| fields | `boss-boss_3-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_4-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_4-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_5-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| fields | `boss-boss_5-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| fields | `boss-boss_6-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_6-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `boss-boss_7-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| fields | `boss-boss_7-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, snaps, units |
| fields | `hidden-boss_10-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `hidden-boss_10-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| fields | `hidden-boss_8-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `hidden-boss_8-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| fields | `hidden-boss_9-pair` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `hidden-boss_9-solo` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: bossHpLeft, enemies, events, fx, hooks, players, rngDraws, snaps, units |
| fields | `unite-1` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, units |
| fields | `unite-2` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| matches | `coop2-ABYSS-10-boosted` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: players, rng, rounds |
| matches | `coop2-HARD-4` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `coop2-NORMAL-1-coverage-standins` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds, standIns |
| matches | `coop2-NORMAL-1-unowned-roster` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds, standIns |
| matches | `coop2-NORMAL-14-standins` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `coop2-NORMAL-3` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `coop2-NORMAL-5-coverage-diy` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: diy, players, rng, rounds |
| matches | `coop2-NORMAL-70-diy` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: diy, end, players, rng, rounds |
| matches | `coop2-NORMAL-8-serverrun` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `coop3-ABYSS-5` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `coop4-ABYSS-7` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `coop4-FUNNY-6` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: players, rng, rounds |
| matches | `solo-ABYSS-1` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `solo-ABYSS-2` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `solo-FUNNY-1` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: players, rng, rounds |
| matches | `solo-FUNNY-2` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `solo-HARD-1` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `solo-HARD-2` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: players, rng, rounds |
| matches | `solo-HARD-9-boosted` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `solo-NORMAL-1` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| matches | `solo-NORMAL-2` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: end, players, rng, rounds |
| roster | `roster-001` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-002` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-003` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, snaps, units |
| roster | `roster-004` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| roster | `roster-005` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-006` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-007` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, snaps, units |
| roster | `roster-008` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-009` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-010` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| roster | `roster-011` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-012` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-013` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| roster | `roster-014` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-015` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| roster | `roster-016` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| roster | `roster-017` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-018` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-019` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-020` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| roster | `roster-021` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-022` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| roster | `roster-023` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, snaps, units |
| roster | `roster-024` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, units |
| roster | `roster-025` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| roster | `roster-026` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, rngDraws, snaps, units |
| roster | `roster-027` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| roster | `roster-028` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-029` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, rngDraws, snaps, units |
| roster | `roster-030` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, snaps, units |
| roster | `roster-031` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| roster | `roster-032` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-033` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| roster | `roster-034` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| roster | `roster-035` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks |
| roster | `roster-036` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-037` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-038` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-039` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| roster | `roster-040` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-041` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, reason, snaps, ticks, time, units |
| roster | `roster-042` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-043` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-044` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| roster | `roster-045` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, units |
| roster | `roster-046` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, players, snaps, units |
| roster | `roster-047` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| roster | `roster-048` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events, hooks, snaps |
| roster | `roster-049` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, hooks, killed, players, snaps, units |
| standins | `standin-01` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| standins | `standin-02` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| standins | `standin-03` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| standins | `standin-04` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, rngDraws, snaps, units |
| standins | `standin-05` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| standins | `standin-06` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| standins | `standin-07` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
| standins | `standin-08` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, killed, players, reason, rngDraws, snaps, ticks, time, units |
| standins | `standin-09` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: enemies, events, fx, hooks, players, rngDraws, snaps, ticks, time, units |
| standins | `standin-10` | updated | Exact upstream v0.3.3 scenario output, including battle fixes and built-in bot changes; fields: events |
