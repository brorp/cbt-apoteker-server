# CBT Apoteker Server API Documentation

## Base URL
- Local: `http://localhost:3001`

## Authentication
- Endpoint yang membutuhkan auth harus mengirim header:
  - `Authorization: Bearer <access_token>`
- JWT payload yang diharapkan:
  - `sub`: user id (angka dalam string)
  - `role`: `admin` atau `user`
  - `email`: opsional

## Endpoints

### 1) Health Check
- Method: `GET`
- Path: `/health`
- Auth: Tidak perlu

#### Success Response
Status: `200 OK`

```json
{
  "status": "ok"
}
```

---

### 2) Start Exam
- Method: `POST`
- Path: `/api/exam/start`
- Auth: Wajib (`Bearer token`)
- Body: Tidak ada

#### Behavior
- Hanya user premium (`users.is_premium = true`) yang bisa mulai ujian.
- Sistem mengambil **200 soal aktif** (`questions.is_active = true`).
- Urutan soal diacak.
- Opsi jawaban (`a-e`) juga diacak per soal.
- Jika user sudah punya sesi `ongoing`, endpoint ini **idempotent**:
  - Tidak membuat sesi baru.
  - Mengembalikan sesi yang sudah berjalan.

#### Success Response (new session)
Status: `201 Created`

```json
{
  "message": "Exam started successfully.",
  "sessionId": 123,
  "startTime": "2026-03-04T16:52:00.000Z",
  "durationMinutes": 200,
  "gracePeriodMinutes": 1,
  "questions": [
    {
      "questionId": 456,
      "order": 1,
      "questionText": "....",
      "options": {
        "a": "....",
        "b": "....",
        "c": "....",
        "d": "....",
        "e": "...."
      }
    }
  ]
}
```

#### Success Response (ongoing session found)
Status: `200 OK`

```json
{
  "message": "Ongoing session found.",
  "sessionId": 123,
  "startTime": "2026-03-04T16:52:00.000Z",
  "durationMinutes": 200,
  "gracePeriodMinutes": 1,
  "questions": [
    {
      "questionId": 456,
      "order": 1,
      "questionText": "....",
      "options": {
        "a": "....",
        "b": "....",
        "c": "....",
        "d": "....",
        "e": "...."
      }
    }
  ]
}
```

#### Error Responses
- `401 Unauthorized`
  - `{"message":"Missing or invalid Authorization header."}`
  - `{"message":"Token is invalid or expired."}`
  - `{"message":"Token payload is invalid."}`
- `403 Forbidden`
  - `{"message":"Premium account required. Complete payment before starting exam."}`
- `404 Not Found`
  - `{"message":"User not found."}`
- `422 Unprocessable Entity`
  - Jika soal aktif kurang dari 200:
  - `{"message":"Insufficient active questions. Required: 200, available: <n>."}`
- `500 Internal Server Error`
  - `{"message":"JWT_SECRET is not configured."}`
  - `{"message":"Internal server error."}`

## Constants Used by Current Implementation
- `EXAM_QUESTION_LIMIT`: `200`
- `EXAM_DURATION_MINUTES`: `200`
- `EXAM_GRACE_PERIOD_MINUTES`: `1`

## Quick cURL Example

```bash
curl -X POST http://localhost:3001/api/exam/start \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json"
```

