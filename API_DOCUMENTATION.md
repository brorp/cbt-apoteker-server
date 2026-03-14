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
- Body:

```json
{
  "package_id": 1
}
```

#### Behavior
- `package_id` wajib diisi.
- Setiap sesi ujian sekarang terkait ke 1 package.
- Sistem mengambil soal aktif berdasarkan `questions.package_id`.
- Jumlah soal mengikuti `exam_packages.question_count`.
- Urutan soal diacak.
- Opsi jawaban (`a-e`) juga diacak per soal.
- Jika user sudah punya sesi `ongoing`, endpoint ini **idempotent**:
  - Tidak membuat sesi baru.
  - Mengembalikan sesi yang sudah berjalan jika package sama.

#### Success Response (new session)
Status: `201 Created`

```json
{
  "message": "Exam started successfully.",
  "sessionId": 123,
  "package_id": 1,
  "package_name": "Try Out CBT Klinis (100 Soal)",
  "question_count": 100,
  "startTime": "2026-03-04T16:52:00.000Z",
  "durationMinutes": 100,
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
  "package_id": 1,
  "package_name": "Try Out CBT Klinis (100 Soal)",
  "question_count": 100,
  "startTime": "2026-03-04T16:52:00.000Z",
  "durationMinutes": 100,
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
- `400 Bad Request`
  - `{"message":"Invalid package_id."}`
- `401 Unauthorized`
  - `{"message":"Missing or invalid Authorization header."}`
  - `{"message":"Token is invalid or expired."}`
  - `{"message":"Token payload is invalid."}`
- `403 Forbidden`
  - Untuk package berbayar jika user belum premium:
  - `{"message":"Premium account required. Complete payment before starting exam."}`
- `404 Not Found`
  - `{"message":"User not found."}`
  - `{"message":"Exam package not found."}`
- `409 Conflict`
  - `{"message":"Another package exam session is still ongoing."}`
- `422 Unprocessable Entity`
  - Jika soal aktif pada package kurang dari `question_count`:
  - `{"message":"Insufficient active questions for package <name>. Required: <required>, available: <n>."}`
- `500 Internal Server Error`
  - `{"message":"JWT_SECRET is not configured."}`
  - `{"message":"Internal server error."}`

## Constants Used by Current Implementation
- `EXAM_GRACE_PERIOD_MINUTES`: `1`
- `durationMinutes`: mengikuti `exam_packages.question_count`

## Quick cURL Example

```bash
curl -X POST http://localhost:3001/api/exam/start \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"package_id":1}'
```

---

### 3) Import Question Bank From `.docx`
- Method: `POST`
- Path: `/api/admin/questions/import`
- Auth: Wajib (`Bearer token` admin)
- Supported Content-Type:
  - `multipart/form-data` dengan field file bernama `file`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Required package:
  - Query `?package_id=1`
  - Atau field multipart `package_id=1`
- Optional flag:
  - Query `?is_active=true`
  - Atau field multipart `is_active=true`
- Default import: `is_active = false`

#### Template Format
- File harus berupa `.docx`
- Tabel menggunakan 3 kolom:
  - `No`
  - `Soal`
  - `Jawaban`
- Setiap baris soal:
  - Kolom `No` hanya referensi urutan dan tidak disimpan ke database
  - Kolom `Soal`: isi soal lalu 5 opsi berurutan untuk `A, B, C, D, E`
  - Kolom `Jawaban`: baris pertama format `Jawaban: E`
  - Baris setelahnya di kolom `Jawaban`: pembahasan

#### Success Response
Status: `201 Created`

```json
{
  "message": "Question bank imported successfully.",
  "imported_count": 5,
  "package_id": 1,
  "package_name": "Mini Try Out CBT Klinis (50 Soal)",
  "is_active": false,
  "file_name": "sample ryan format.docx",
  "question_ids": [101, 102, 103, 104, 105]
}
```

#### Error Responses
- `400 Bad Request`
  - File bukan `.docx`
  - Template tidak punya tabel valid
  - Salah satu baris tidak memenuhi format soal / jawaban / pembahasan
- `413 Payload Too Large`
  - File lebih dari `10 MB`
- `500 Internal Server Error`

#### Multipart cURL Example

```bash
curl -X POST http://localhost:3001/api/admin/questions/import \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -F "file=@/absolute/path/template-bank-soal.docx" \
  -F "package_id=1" \
  -F "is_active=false"
```

---

### 4) Get Exam Result
- Method: `GET`
- Path: `/api/exam/result/:sessionId`
- Auth: Wajib

#### Notes
- Endpoint ini hanya bisa diakses setelah sesi selesai.
- Setiap item di `questions` pada response hasil ujian mengandung:
  - `selectedOption`
  - `correctAnswer`
  - `explanation`
- Artinya pembahasan dari template import `.docx` sudah ikut tersimpan dan bisa ditampilkan ke peserta setelah ujian selesai.
