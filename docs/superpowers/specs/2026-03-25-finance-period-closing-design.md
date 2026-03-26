# Finance Period Closing (Cortes Mensuales) — Design Spec

## Status

Draft

## Date

2026-03-25

## Problem

The finances module allows any user with permissions to create, edit, or delete financial movements in any past month without restriction. There is no concept of a "closed period," which means historical financial data can be modified at any time. This undermines auditability and data integrity for club treasurers and administrators.

## Solution: Approach A — `finance_period_closings` Table + Cron Job

A cron job runs on the 1st of each month to snapshot the previous month's financial data per club. Once a period is closed, only admin/super_admin users can modify movements in that period (with mandatory justification). Normal users are blocked from any modifications to closed periods.

---

## 1. Data Model

### 1.1 New Table: `finance_period_closings`

| Column                     | Type       | Notes                                           |
| -------------------------- | ---------- | ----------------------------------------------- |
| `finance_period_closing_id`| `Int`      | `@id @default(autoincrement())`                 |
| `club_id`                  | `Int`      | FK → `clubs`                                    |
| `year`                     | `Int`      |                                                 |
| `month`                    | `Int`      | 1–12                                            |
| `total_income`             | `Int`      | Sum of income movements (centavos)              |
| `total_expense`            | `Int`      | Sum of expense movements (centavos)             |
| `balance`                  | `Int`      | `total_income - total_expense`                  |
| `movement_count`           | `Int`      | Total number of movements in the period         |
| `breakdown`                | `Json`     | Category + section breakdown (see §1.3)         |
| `closed_at`                | `DateTime` | Timestamp of when the closing was executed      |
| `closed_by`                | `String?`  | `null` = system (cron), UUID = admin who forced |
| `created_at`               | `DateTime` | `@default(now())`                               |

**Unique constraint:** `@@unique([club_id, year, month])` — one closing per club per period.

### 1.2 New Column on `finances` Table

| Column              | Type      | Notes                                                       |
| ------------------- | --------- | ----------------------------------------------------------- |
| `post_closing_note` | `String?` | Justification for post-closing adjustments. `null` = normal |

### 1.3 `breakdown` JSON Structure

```json
{
  "by_category": [
    {
      "finance_category_id": 1,
      "name": "Cuotas",
      "type": 0,
      "total": 5000
    },
    {
      "finance_category_id": 3,
      "name": "Materiales",
      "type": 1,
      "total": 2000
    }
  ],
  "by_section": [
    {
      "club_section_id": 1,
      "club_type_name": "Conquistadores",
      "income": 3000,
      "expense": 1500,
      "balance": 1500
    },
    {
      "club_section_id": 2,
      "club_type_name": "Aventureros",
      "income": 2000,
      "expense": 500,
      "balance": 1500
    }
  ]
}
```

- `by_category`: aggregated totals per finance category, preserving `type` (0 = income, 1 = expense).
- `by_section`: aggregated income/expense/balance per club section.

---

## 2. Cron Job — Automatic Closing

A new `FinancePeriodService` registered in `FinancesModule` runs the closing logic.

### 2.1 Schedule

```typescript
@Cron('0 0 1 * *')  // 1st of each month at 00:00 UTC
```

### 2.2 Closing Algorithm

1. Query all active clubs with their sections.
2. For each club, calculate the snapshot of the **previous month**:
   - Sum `total_income`, `total_expense`, derive `balance`.
   - Count `movement_count`.
   - Build `breakdown` JSON (by category + by section).
3. Insert into `finance_period_closings`.
4. If a club had **zero movements** that month, create the closing record anyway with all totals at 0. This provides an explicit audit trail that the period was reviewed and closed.
5. Log each successful and failed closing operation.

### 2.3 Idempotency

The unique constraint on `(club_id, year, month)` guarantees idempotency. If a closing already exists for a given club/period, the insert is skipped (catch unique constraint violation, log, continue). This allows safe re-runs without data corruption.

### 2.4 Dependencies

- `@nestjs/schedule` — already available or trivial to add via `pnpm add @nestjs/schedule`.
- `ScheduleModule.forRoot()` must be imported in `AppModule` if not already present.

---

## 3. Validation on Existing Endpoints

Period closing validation is added to `create`, `update`, and `remove` methods in `FinancesService`.

### 3.1 Validation Logic

Before any write operation, check whether a `finance_period_closings` record exists for the movement's `(club_id, year, month)`:

| Closing exists? | User role          | Result                                              |
| --------------- | ------------------ | --------------------------------------------------- |
| No              | Any                | Allow normally                                      |
| Yes             | `admin` / `super_admin` | Allow — `post_closing_note` required in DTO    |
| Yes             | Other roles        | **403** — `"El periodo {month}/{year} está cerrado"` |

### 3.2 Target Resolution per Operation

| Operation  | Year/Month source                        |
| ---------- | ---------------------------------------- |
| `create`   | From DTO (`year`, `month`)               |
| `update`   | From the **existing** movement record    |
| `remove`   | From the **existing** movement record    |

### 3.3 Implementation Pattern

```typescript
private async validatePeriodOpen(
  clubId: number,
  year: number,
  month: number,
  userRole: string,
): Promise<void> {
  const closing = await this.prisma.financePeriodClosing.findUnique({
    where: { club_id_year_month: { club_id: clubId, year, month } },
  });

  if (closing && !['admin', 'super_admin'].includes(userRole)) {
    throw new ForbiddenException(
      `El periodo ${month}/${year} está cerrado`,
    );
  }
}
```

For admin/super_admin writing to a closed period, the `post_closing_note` field from the DTO is persisted on the `finances` record.

---

## 4. Post-Closing Movements by Admin

When an `admin` or `super_admin` creates or edits a movement in a closed period:

1. The DTO accepts an optional `post_closing_note` (string).
2. This justification is stored in the new `post_closing_note` column on `finances`.
3. The field serves as an audit trail for why a closed period was modified.
4. For movements in **open** periods, `post_closing_note` remains `null`.

### 4.1 DTO Changes

Add to `CreateFinanceDto` and `UpdateFinanceDto`:

```typescript
@IsOptional()
@IsString()
@MaxLength(500)
post_closing_note?: string;
```

Validation rule: if the period is closed and the user is admin, `post_closing_note` SHOULD be provided. The system does not enforce it as mandatory to avoid blocking admin operations, but the UI should strongly encourage it.

---

## 5. Permissions

| Actor                 | Action                                  | Permission needed        |
| --------------------- | --------------------------------------- | ------------------------ |
| Cron (system)         | Create closing records                  | Internal — no guard      |
| Normal user           | Blocked from modifying closed periods   | Existing finance perms   |
| `admin` / `super_admin` | Override closed period restrictions   | Existing role in JWT     |

- No new RBAC permissions are introduced.
- Admin/super_admin detection uses `req.user.role` already present in the JWT payload.
- Existing guards (`PermissionsGuard`, `ClubRolesGuard`) remain unchanged.

---

## 6. Endpoints

No new user-facing endpoints are created. The existing `GET /clubs/:clubId/finances/summary` with year/month filters is sufficient for consulting period data.

The `finance_period_closings` records serve as **internal audit snapshots**. A dedicated listing/querying endpoint for closings may be added in a future iteration if needed.

---

## 7. Files Affected

| File                                          | Change                                         |
| --------------------------------------------- | ---------------------------------------------- |
| `prisma/schema.prisma`                        | New `FinancePeriodClosing` model + `post_closing_note` column on `Finance` |
| `src/finances/finances.service.ts`            | Add `validatePeriodOpen()` to `create`, `update`, `remove` |
| `src/finances/dto/create-finance.dto.ts`      | Add `post_closing_note` optional field         |
| `src/finances/dto/update-finance.dto.ts`      | Add `post_closing_note` optional field         |
| `src/finances/finance-period.service.ts`      | **New** — cron job + closing snapshot logic     |
| `src/finances/finances.module.ts`             | Register `FinancePeriodService`, import `ScheduleModule` |

---

## 8. Edge Cases

- **Club with no movements in a month**: closing record is still created with zero totals. This distinguishes "no activity" from "not yet closed."
- **Cron fails mid-run**: idempotent by design. Re-running processes only the clubs that don't have a closing for that period yet.
- **Movement spans month boundary**: movements belong to the month specified in their `year`/`month` fields, not their `created_at` timestamp.
- **Admin edits after closing**: the closing snapshot is NOT retroactively updated. The snapshot reflects the state at closing time. Post-closing modifications are tracked via `post_closing_note` on individual movements.
- **Manual/forced closing**: the `closed_by` field supports a user UUID for future admin-triggered closings. Initial implementation is cron-only (`closed_by = null`).

---

## 9. Future Considerations

- **Reopening a closed period**: not in scope. If needed, could be modeled as deleting the closing record (admin-only, audited).
- **Closing dashboard**: a dedicated UI to view closing history per club, compare snapshots, and flag post-closing modifications.
- **Retroactive snapshot updates**: recalculate the breakdown after post-closing edits. Adds complexity; deferred unless audit requirements demand it.
