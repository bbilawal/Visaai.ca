# Codex review — changes currently under review

**Status: changes requested. Do not mark this task complete yet.**

## Blocker 1 — API build is broken

`pnpm --filter api build` fails in `admin-dashboard.service.ts` because the
new `pageRows<Record<string, unknown>>` call causes the `reduce` accumulator
to infer as `Record<string, unknown>`. The two cost additions and the final
`AdminDashboardRaw.ai` assignment therefore fail type checking.

Fix this with a concrete row type and/or explicit accumulator type, without
using `any` or unsafe casts for the aggregate. Then run the API build again.

## Blocker 2 — the new admin predicate disagrees with the real authorization gate

`JwtGuard.resolveAppRole` authorizes a user as `admin` not only from signed
`app_metadata.role` or `ADMIN_EMAILS`, but also from `user_roles` joined to
roles with key `platform_admin` or `super_admin`.

`isPlatformAdmin()` and `platformAdminIds()` only implement the first two
sources. This means a platform admin created through the RBAC tables is:

- omitted from watchdog/DLQ/broadcast recipients;
- omitted from `adminCount()` and last-admin protection; and
- vulnerable to being assigned legacy role `user`, after which the JWT guard
  sees that valid legacy role first and will not fall back to the RBAC grant.

Refactor the admin-recipient/count/role-change paths so their definition of an
admin exactly matches the JWT guard's full resolution order. Add tests for a
`platform_admin` and a `super_admin` user-role grant, including an attempted
demotion of the last such admin. Do not merely change comments.

## Required verification

Run and record the results of:

```sh
pnpm --filter api build
pnpm --filter api test -- --runInBand \
  src/modules/shared/supabase/page-rows.spec.ts \
  src/modules/admin/admin-recipients.spec.ts \
  src/modules/admin/admin-users.guests-and-admins.spec.ts \
  src/modules/admin/admin.service.setrole.spec.ts \
  src/modules/admin/registry-ops.service.spec.ts \
  src/modules/forms/template-health.service.spec.ts \
  src/modules/notifications/ops/notification-ops.service.spec.ts \
  src/modules/notifications/broadcast/notification-broadcast.service.spec.ts
```

The focused test command passed at review time (60 tests), but that is not
approval while the build fails and the RBAC model remains incomplete.
