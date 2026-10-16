# Sales order status transition matrix

This matrix is the source of truth for sales-order status changes. The
`pending_approval` value is a workflow gate, not a stock lifecycle state:
approval decisions move the order to the originally requested status in the
governance route. It must not be bypassed through the sales PATCH endpoint.

## Lifecycle and effects

| Lifecycle position | Status | Inventory state | Customer balance |
|---:|---|---|---|
| 0 | `draft` | no reservation | no outstanding balance |
| gate | `pending_approval` | managed by the approval request | managed by the requested target |
| 1 | `confirmed` | reserved | outstanding |
| 2 | `shipped` | physically deducted | outstanding |
| 3 | `paid` | physically deducted | settled |
| final | `cancelled` | no reservation and no deduction | no outstanding balance |

The transition planner walks through the intermediate lifecycle positions even
when the request jumps directly over one. Therefore `draft → shipped` reserves,
releases the reservation, and deducts physical stock; `draft → paid` also
creates and settles the intermediate customer balance in the same transaction.

## Complete matrix

Legend:

- **مسموح — لا أثر**: valid no-op.
- **مسموح — ...**: valid transition and the listed effects run in order.
- **ممنوع**: rejected with HTTP `409`; the order is not updated.
- **مسار الاعتماد**: the order must be changed by the approval decision route,
  not by a direct sales status PATCH.

| From \ To | `draft` | `pending_approval` | `confirmed` | `shipped` | `paid` | `cancelled` |
|---|---|---|---|---|---|---|
| `draft` | مسموح — لا أثر | مسموح — لا أثر | مسموح — reserve + increase balance | مسموح — reserve + increase balance + release reservation + deduct stock | مسموح — reserve + increase balance + release reservation + deduct stock + decrease balance | مسموح — لا أثر |
| `pending_approval` | ممنوع — رجوع للخلف | مسموح — لا أثر | ممنوع — مسار الاعتماد | ممنوع — مسار الاعتماد | ممنوع — مسار الاعتماد | ممنوع — مسار الاعتماد |
| `confirmed` | ممنوع — رجوع للخلف | ممنوع — لا يمكن فتح اعتماد جديد بهذه الطريقة | مسموح — لا أثر | مسموح — release reservation + deduct stock | مسموح — release reservation + deduct stock + decrease balance | مسموح — release reservation + decrease balance |
| `shipped` | ممنوع — رجوع للخلف | ممنوع — لا يمكن فتح اعتماد جديد بهذه الطريقة | ممنوع — رجوع للخلف | مسموح — لا أثر | مسموح — decrease balance | مسموح — restore stock + decrease balance |
| `paid` | ممنوع — رجوع للخلف | ممنوع — لا يمكن فتح اعتماد جديد بهذه الطريقة | ممنوع — رجوع للخلف | ممنوع — رجوع للخلف | مسموح — لا أثر | مسموح — restore stock |
| `cancelled` | ممنوع — حالة نهائية | ممنوع — حالة نهائية | ممنوع — حالة نهائية | ممنوع — حالة نهائية | ممنوع — حالة نهائية | مسموح — لا أثر |

## Central planner design

`src/lib/salesStatusTransition.ts` owns the status vocabulary, the lifecycle
positions, the allowed-transition rules, and the pure effect plan. It does not
access PostgreSQL. Its main function is:

```ts
computeStockAndBalanceEffects(fromStatus, toStatus)
```

It returns an allowed/forbidden plan containing ordered steps from:

- `reserve`
- `releaseReservation`
- `deductStock`
- `restoreStock`
- `increaseBalance`
- `decreaseBalance`

The route layer executes that plan inside its existing transaction, performs the
credit-limit check before an `increaseBalance` step, and marks
`sales_orders.stock_sync_status = 'synced'` only after the transaction's
inventory work succeeds. Existing rows receive `pending_review` from the new
migration so historical inconsistencies stay visible until reviewed.

Adding a future lifecycle status requires adding one position and its explicit
matrix rules in the central module, rather than adding another independent
`if/else` branch to the route.