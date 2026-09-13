# ZUT Backend API v1

The backend API is versioned under /api/v1. All task endpoints require a
Bearer token when the service is not bound to localhost.

## Health

GET /api/v1/health returns the API status, configured engine, enabled engines,
limits, and supported features. It never returns LLM credentials.

## Create a task

POST /api/v1/tasks uses multipart/form-data:

| Field | Required | Description |
|---|---:|---|
| file | yes | PDF file |
| sourceLanguage | no | auto by default |
| targetLanguage | no | zh-CN by default |
| engine | no | configured engine |
| outputMode | no | bilingual or translated |
| clientRequestId | no | client-generated idempotency key |

The first submission returns 202 Accepted. An identical request returns the
existing task with deduplicated: true.

## Task lifecycle

GET /api/v1/tasks/{taskId} returns the durable task state:

~~~text
queued -> processing -> completed
   |          |
   +--------> failed
   |          |
   +-------> cancelled
~~~

The client polls this endpoint. SSE is intentionally not enabled in v0.1.

## Cancel and download

- POST /api/v1/tasks/{taskId}/cancel requests cancellation.
- GET /api/v1/tasks/{taskId}/file downloads a completed PDF.
- GET /api/v1/tasks?state=completed&limit=20&offset=0 lists history.

Errors use this shape:

~~~json
{
  "code": "ENGINE_UNAVAILABLE",
  "message": "translation engine is unavailable",
  "retryable": false,
  "requestId": "uuid",
  "details": {}
}
~~~
