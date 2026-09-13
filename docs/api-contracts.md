# API Contracts — Phase 02 Foundation

## Response shape

New and migrated endpoints use these shapes:

```json
{ "data": {}, "message": "optional", "meta": {} }
```

Errors always use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "رسالة آمنة للمستخدم",
    "details": [],
    "reference": "optional"
  }
}
```

The shared server definitions are in `src/contracts/`:

- `api-response.ts`: success and error envelopes.
- `errors.ts`: typed HTTP/domain errors and error codes.
- `pagination.ts`: bounded page/pageSize parsing and metadata.

## Compatibility rule

Existing endpoints are migrated domain by domain. No frontend should parse a
second error format. During migration, `public/JS/auth.js` remains the single
transport client and reads `error.code`, `error.details`, and
`error.reference` without changing successful legacy payloads.

## Status mapping

- 400: validation or invalid state input.
- 401: missing/expired authentication.
- 403: authenticated but forbidden.
- 404: resource or route not found.
- 409: duplicate or invalid business transition.
- 500: unexpected server failure, with a log reference.

## Pagination rule

`page` starts at 1 and `pageSize` is bounded to 1–100. New list endpoints
return pagination metadata; existing list payloads are preserved until their
frontend caller is migrated.