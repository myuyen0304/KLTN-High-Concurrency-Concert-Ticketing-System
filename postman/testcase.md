# Test Cases — Concert Ticketing System API

**Base URL:** `http://localhost:3000/api/v1`  
**Auth:** Bearer JWT — lấy từ `POST /auth/login`, gán vào header `Authorization: Bearer <token>`

**Format lỗi chuẩn (tất cả error đều trả về):**
```json
{
  "statusCode": 401,
  "message": "Token không hợp lệ hoặc đã hết hạn",
  "path": "/api/v1/users/me",
  "timestamp": "2026-05-15T05:00:00.000Z"
}
```

---

## Chuẩn bị

1. `cd concert-ticketing && docker compose up -d`
2. `npm run start:dev`
3. Mở Postman, tạo Collection Variables:
   - `BASE_URL` = `http://localhost:3000/api/v1`
   - `TOKEN` = _(để trống, điền sau khi login)_
   - `ORGANIZER_TOKEN` = _(để trống, điền sau khi login organizer)_
   - `EVENT_ID` = _(để trống, điền sau khi tạo event)_
   - `TICKET_TYPE_ID` = _(để trống, điền sau khi tạo ticket type)_

---

## Module: Auth

### TC-AUTH-01 — Đăng ký thành công

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/register` |
| Body (JSON) | `{ "email": "user@example.com", "password": "Password123!", "fullName": "Nguyen Van A" }` |
| Status | `201 Created` |
| Response | `{ "message": "Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản." }` |
| Ghi chú | OTP 6 chữ số xuất hiện trong terminal server: `[DEV OTP] user@example.com → 123456` |

---

### TC-AUTH-02 — Đăng ký có phone (optional)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/register` |
| Body (JSON) | `{ "email": "user2@example.com", "password": "Password123!", "fullName": "Nguyen Van B", "phone": "0901234567" }` |
| Status | `201 Created` |
| Response | `{ "message": "Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản." }` |

---

### TC-AUTH-03 — Đăng ký email đã tồn tại (ACTIVE)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/register` |
| Body (JSON) | `{ "email": "user@example.com", "password": "Password123!", "fullName": "Nguyen Van C" }` |
| Điều kiện | Chạy sau TC-AUTH-01 và TC-AUTH-04 (user đã ACTIVE) |
| Status | `409 Conflict` |
| Response | `{ "statusCode": 409, "message": "Email đã được sử dụng", "path": "/api/v1/auth/register", "timestamp": "..." }` |

---

### TC-AUTH-04 — Đăng ký email đang PENDING_VERIFY (gửi lại OTP)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/register` |
| Body (JSON) | `{ "email": "user@example.com", "password": "Password123!", "fullName": "Nguyen Van A" }` |
| Điều kiện | Chạy sau TC-AUTH-01, trước khi verify OTP |
| Status | `201 Created` |
| Response | `{ "message": "Tài khoản chưa được xác thực. OTP mới đã được gửi đến email." }` |

---

### TC-AUTH-05 — Đăng ký thiếu field bắt buộc

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/register` |
| Body (JSON) | `{ "email": "test@example.com" }` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": ["password should not be empty", "fullName should not be empty"], "path": "...", "timestamp": "..." }` |

---

### TC-AUTH-06 — Xác thực OTP đúng

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/verify-otp` |
| Body (JSON) | `{ "email": "user@example.com", "otp": "123456" }` |
| Ghi chú | Lấy OTP từ terminal server sau TC-AUTH-01 |
| Status | `200 OK` |
| Response | `{ "message": "Xác thực email thành công. Tài khoản đã được kích hoạt." }` |

---

### TC-AUTH-07 — Xác thực OTP sai

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/verify-otp` |
| Body (JSON) | `{ "email": "user@example.com", "otp": "000000" }` |
| Status | `401 Unauthorized` |
| Response | `{ "statusCode": 401, "message": "OTP không đúng. Còn 2 lần thử.", "path": "...", "timestamp": "..." }` |

---

### TC-AUTH-08 — Xác thực OTP hết hạn / không tồn tại

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/verify-otp` |
| Body (JSON) | `{ "email": "notexist@example.com", "otp": "123456" }` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": "OTP không hợp lệ hoặc đã hết hạn", "path": "...", "timestamp": "..." }` |

---

### TC-AUTH-09 — Gửi lại OTP

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/resend-otp` |
| Body (JSON) | `{ "email": "user2@example.com" }` |
| Điều kiện | user2 đang ở trạng thái PENDING_VERIFY |
| Status | `200 OK` |
| Response | `{ "message": "OTP mới đã được gửi đến email của bạn." }` |
| Ghi chú | OTP mới xuất hiện trong terminal |

---

### TC-AUTH-10 — Gửi lại OTP cho email không tồn tại (anti-enumeration)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/resend-otp` |
| Body (JSON) | `{ "email": "ghost@example.com" }` |
| Status | `200 OK` |
| Response | `{ "message": "Nếu email tồn tại và chưa được xác thực, OTP mới đã được gửi." }` |
| Ghi chú | Trả 200 để tránh email enumeration attack |

---

### TC-AUTH-11 — Login thành công

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/login` |
| Body (JSON) | `{ "email": "user@example.com", "password": "Password123!" }` |
| Điều kiện | user đã ACTIVE (sau TC-AUTH-06) |
| Status | `200 OK` |
| Response | `{ "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }` |
| Ghi chú | Copy `accessToken` vào biến `TOKEN` của Postman |

---

### TC-AUTH-12 — Login sai mật khẩu

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/login` |
| Body (JSON) | `{ "email": "user@example.com", "password": "WrongPass!" }` |
| Status | `401 Unauthorized` |
| Response | `{ "statusCode": 401, "message": "Email hoặc mật khẩu không đúng", "path": "...", "timestamp": "..." }` |

---

### TC-AUTH-13 — Login khi chưa xác thực OTP

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/login` |
| Body (JSON) | `{ "email": "user2@example.com", "password": "Password123!" }` |
| Điều kiện | user2 vẫn ở trạng thái PENDING_VERIFY |
| Status | `401 Unauthorized` |
| Response | `{ "statusCode": 401, "message": "Vui lòng xác thực email trước khi đăng nhập.", "path": "...", "timestamp": "..." }` |

---

### TC-AUTH-14 — Logout thành công

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/auth/logout` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "message": "Đăng xuất thành công" }` |

---

### TC-AUTH-15 — Dùng token sau khi logout (blacklist)

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/users/me` |
| Header | `Authorization: Bearer <token vừa logout ở TC-AUTH-14>` |
| Status | `401 Unauthorized` |
| Response | `{ "statusCode": 401, "message": "Token đã bị vô hiệu hóa", "path": "...", "timestamp": "..." }` |
| Verify Redis | `docker exec -it concert_redis redis-cli KEYS "blacklist:token:*"` → thấy key |

---

## Module: Users

> Tất cả TC dưới đây yêu cầu `Authorization: Bearer {{TOKEN}}`

### TC-USER-01 — Xem profile

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/users/me` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "id": "uuid", "email": "user@example.com", "fullName": "Nguyen Van A", "phone": null, "avatarUrl": null, "status": "ACTIVE", "roles": ["USER"], "createdAt": "2026-05-15T..." }` |
| Ghi chú | Không có trường `passwordHash` |

---

### TC-USER-02 — Xem profile không có token

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/users/me` |
| Status | `401 Unauthorized` |
| Response | `{ "statusCode": 401, "message": "Token không hợp lệ hoặc đã hết hạn", "path": "...", "timestamp": "..." }` |

---

### TC-USER-03 — Cập nhật profile

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/users/me` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "fullName": "Nguyen Van A Updated", "phone": "0901234567" }` |
| Status | `200 OK` |
| Response | `{ "id": "uuid", "email": "user@example.com", "fullName": "Nguyen Van A Updated", "phone": "0901234567", "avatarUrl": null, "status": "ACTIVE", "roles": ["USER"], "createdAt": "..." }` |

---

### TC-USER-04 — Cập nhật profile không có field nào

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/users/me` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{}` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": "Không có trường nào được cập nhật", "path": "...", "timestamp": "..." }` |

---

### TC-USER-05 — Đổi email: gửi OTP

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/users/me/change-email` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "newEmail": "newemail@example.com" }` |
| Status | `200 OK` |
| Response | `{ "message": "OTP xác nhận đã được gửi đến email mới." }` |
| Ghi chú | OTP xuất hiện trong terminal: `[DEV OTP email-change] newemail@example.com → 654321` |

---

### TC-USER-06 — Đổi email: xác nhận OTP đúng

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/users/me/verify-email-change` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "otp": "654321" }` |
| Status | `200 OK` |
| Response | `{ "message": "Đổi email thành công." }` |
| Ghi chú | Verify bằng `GET /users/me` → email đã đổi |

---

### TC-USER-07 — Đổi email trùng với email đã tồn tại

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/users/me/change-email` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "newEmail": "user@example.com" }` |
| Status | `409 Conflict` |
| Response | `{ "statusCode": 409, "message": "Email này đã được sử dụng", "path": "...", "timestamp": "..." }` |

---

## Module: Events (Public — không cần auth)

### TC-EVENT-01 — Lấy danh sách sự kiện

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/events` |
| Status | `200 OK` |
| Response | `{ "total": 0, "page": 1, "limit": 20, "items": [] }` |
| Ghi chú | Chỉ trả events có status `ACTIVE`. Lúc mới test sẽ rỗng |

---

### TC-EVENT-02 — Phân trang và filter

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/events?page=1&limit=5&keyword=rock&category=Music` |
| Status | `200 OK` |
| Response | `{ "total": 0, "page": 1, "limit": 5, "items": [] }` |

---

### TC-EVENT-03 — Chi tiết sự kiện không tồn tại

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/events/00000000-0000-0000-0000-000000000000` |
| Status | `404 Not Found` |
| Response | `{ "statusCode": 404, "message": "Sự kiện không tồn tại hoặc chưa được công khai", "path": "...", "timestamp": "..." }` |

---

## Module: Events (Organizer — cần ORGANIZER_TOKEN)

> **Chuẩn bị:** Trước khi chạy các TC dưới, cần seed dữ liệu cho organizer qua Prisma Studio (`npx prisma studio`):
> 1. Thêm role `ORGANIZER` vào bảng `roles` (nếu chưa có)
> 2. Thêm record vào `user_roles` gán role ORGANIZER cho user organizer
> 3. Thêm record vào `organizer_profiles` với `userId` của user organizer

### TC-EVENT-04 — Tạo sự kiện (lưu DRAFT)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "title": "Rock Concert 2026", "description": "Đêm nhạc rock tại TPHCM", "category": "Music", "startTime": "2026-08-01T18:00:00Z", "endTime": "2026-08-01T22:00:00Z", "venue": "Nhà thi đấu Phú Thọ, TPHCM", "maxTicketsPerUser": 4 }` |
| Status | `201 Created` |
| Response | `{ "id": "uuid", "title": "Rock Concert 2026", "description": "Đêm nhạc rock tại TPHCM", "category": "Music", "startTime": "2026-08-01T18:00:00.000Z", "endTime": "2026-08-01T22:00:00.000Z", "venue": "Nhà thi đấu Phú Thọ, TPHCM", "bannerUrl": null, "status": "DRAFT", "ticketModel": null, "maxTicketsPerUser": 4, "createdAt": "...", "updatedAt": "..." }` |
| Ghi chú | Lưu `id` vào biến `EVENT_ID` |

---

### TC-EVENT-05 — Tạo sự kiện và submit luôn

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "title": "Jazz Night 2026", "startTime": "2026-09-15T19:00:00Z", "endTime": "2026-09-15T23:00:00Z", "action": "SUBMIT" }` |
| Status | `201 Created` |
| Response | `{ "id": "uuid", ..., "status": "PENDING_APPROVAL", ... }` |

---

### TC-EVENT-06 — Tạo sự kiện không có OrganizerProfile

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events` |
| Header | `Authorization: Bearer {{TOKEN}}` _(token user thường)_ |
| Body (JSON) | `{ "title": "Test", "startTime": "2026-08-01T18:00:00Z", "endTime": "2026-08-01T22:00:00Z" }` |
| Status | `403 Forbidden` |
| Response | `{ "statusCode": 403, "message": "Bạn chưa có hồ sơ nhà tổ chức", "path": "...", "timestamp": "..." }` |

---

### TC-EVENT-07 — Tạo sự kiện không có token

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events` |
| Body (JSON) | `{ "title": "Test", "startTime": "2026-08-01T18:00:00Z", "endTime": "2026-08-01T22:00:00Z" }` |
| Status | `401 Unauthorized` |

---

### TC-EVENT-08 — Cập nhật sự kiện của mình (DRAFT)

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "title": "Rock Concert 2026 - Updated", "description": "Cập nhật mô tả" }` |
| Status | `200 OK` |
| Response | `{ "id": "{{EVENT_ID}}", "title": "Rock Concert 2026 - Updated", ..., "status": "DRAFT", ... }` |

---

### TC-EVENT-09 — Cập nhật sự kiện của người khác

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/events/00000000-0000-0000-0000-000000000001` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "title": "Hack" }` |
| Status | `404 Not Found` |
| Response | `{ "statusCode": 404, "message": "Sự kiện không tồn tại", "path": "...", "timestamp": "..." }` |

---

### TC-EVENT-10 — Submit sự kiện

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/submit` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `201 Created` |
| Response | `{ "id": "{{EVENT_ID}}", ..., "status": "PENDING_APPROVAL", ... }` |

---

### TC-EVENT-11 — Submit sự kiện đã PENDING_APPROVAL

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/submit` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Điều kiện | Chạy sau TC-EVENT-10 |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": "Chỉ gửi duyệt sự kiện ở trạng thái DRAFT hoặc REJECTED", "path": "...", "timestamp": "..." }` |

---

## Module: Ticket Types

### TC-TICKET-01 — Tạo loại vé VIP

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/ticket-types` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "name": "VIP", "price": 500000, "quantity": 100, "saleStartTime": "2026-07-01T00:00:00Z", "saleEndTime": "2026-07-31T23:59:59Z", "description": "Khu vực VIP sát sân khấu" }` |
| Status | `201 Created` |
| Response | `{ "id": "uuid", "eventId": "{{EVENT_ID}}", "name": "VIP", "price": "500000", "quantity": 100, "sold": 0, "saleStartTime": "2026-07-01T00:00:00.000Z", "saleEndTime": "2026-07-31T23:59:59.000Z", "description": "Khu vực VIP sát sân khấu", "isHidden": false, "createdAt": "...", "updatedAt": "..." }` |
| Ghi chú | Lưu `id` vào biến `TICKET_TYPE_ID` |

---

### TC-TICKET-02 — Tạo loại vé General

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/ticket-types` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "name": "General", "price": 200000, "quantity": 500, "saleStartTime": "2026-07-01T00:00:00Z", "saleEndTime": "2026-07-31T23:59:59Z" }` |
| Status | `201 Created` |
| Response | `{ "id": "uuid", ..., "name": "General", "price": "200000", "quantity": 500, ... }` |
| Ghi chú | Lưu `id` vào `GENERAL_TICKET_TYPE_ID` |

---

### TC-TICKET-03 — Tạo loại vé thiếu `saleStartTime`

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/ticket-types` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "name": "VIP", "price": 500000, "quantity": 100 }` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": ["saleStartTime must be a valid ISO 8601 date string", "saleEndTime must be a valid ISO 8601 date string"], ... }` |

---

### TC-TICKET-04 — Cập nhật loại vé

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/ticket-types/{{TICKET_TYPE_ID}}` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "quantity": 150, "description": "Khu vực VIP mở rộng" }` |
| Status | `200 OK` |
| Response | `{ "id": "{{TICKET_TYPE_ID}}", ..., "quantity": 150, "description": "Khu vực VIP mở rộng", ... }` |

---

### TC-TICKET-05 — Ẩn loại vé

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/ticket-types/{{TICKET_TYPE_ID}}/hide` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "id": "{{TICKET_TYPE_ID}}", ..., "isHidden": true, ... }` |
| Ghi chú | Loại vé sẽ không hiện trong `GET /events/:id` public |

---

### TC-TICKET-06 — Xóa loại vé (chưa có vé bán)

| Thuộc tính | Giá trị |
|---|---|
| Method | `DELETE` |
| URL | `{{BASE_URL}}/ticket-types/{{TICKET_TYPE_ID}}` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "message": "Đã xóa loại vé" }` |

---

## Module: Seats

### TC-SEAT-01 — Xem layout khi chưa có seat-map

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats` |
| Status | `200 OK` |
| Response | `{ "ticketModel": null }` |

---

### TC-SEAT-02 — Tạo SEAT_MAP (5 hàng × 10 ghế)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats/seat-map` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "sections": [{ "rows": 5, "seatsPerRow": 10, "ticketTypeId": "{{TICKET_TYPE_ID}}" }] }` |
| Status | `201 Created` |
| Response | `{ "total": 50, "seats": [{ "id": "uuid", "row": "A", "number": "1", "label": "A1", "status": "AVAILABLE", "ticketTypeId": "{{TICKET_TYPE_ID}}" }, ...] }` |
| Ghi chú | Tạo 50 ghế: A1→A10, B1→B10, ..., E1→E10 |

---

### TC-SEAT-03 — Tạo SEAT_MAP nhiều section với rowPrefix

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats/seat-map` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "sections": [{ "rows": 3, "seatsPerRow": 10, "rowPrefix": "VIP", "ticketTypeId": "{{VIP_TICKET_TYPE_ID}}" }, { "rows": 5, "seatsPerRow": 20, "rowPrefix": "GA", "ticketTypeId": "{{GENERAL_TICKET_TYPE_ID}}" }] }` |
| Điều kiện | Event chưa có ticketModel |
| Status | `201 Created` |
| Response | `{ "total": 130, "seats": [{ "row": "VIP1", "number": "1", "label": "VIP11", ... }, ...] }` |

---

### TC-SEAT-04 — Tạo SEAT_MAP khi đã có model (lỗi)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats/seat-map` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "sections": [{ "rows": 2, "seatsPerRow": 5, "ticketTypeId": "{{TICKET_TYPE_ID}}" }] }` |
| Điều kiện | Chạy sau TC-SEAT-02 |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": "Sự kiện đã có mô hình vé. Dùng endpoint chỉnh sửa.", ... }` |

---

### TC-SEAT-05 — Tạo ZONE

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats/zone` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "zones": [{ "name": "Zone VIP", "capacity": 200, "ticketTypeId": "{{VIP_TICKET_TYPE_ID}}" }, { "name": "Zone GA", "capacity": 1000 }] }` |
| Điều kiện | Event chưa có ticketModel |
| Status | `201 Created` |
| Response | `[{ "id": "uuid", "eventId": "...", "name": "Zone VIP", "capacity": 200, "ticketTypeId": "...", ... }, { "id": "uuid", ..., "name": "Zone GA", "capacity": 1000, "ticketTypeId": null, ... }]` |

---

### TC-SEAT-06 — Xem layout sau khi tạo SEAT_MAP

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats` |
| Status | `200 OK` |
| Response | `{ "ticketModel": "SEAT_MAP", "seats": [{ "id": "uuid", "row": "A", "number": "1", "label": "A1", "status": "AVAILABLE", "ticketTypeId": "..." }, ...] }` |

---

### TC-SEAT-07 — Thêm section vào SEAT_MAP đã có

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "addSections": [{ "rows": 2, "seatsPerRow": 10, "rowPrefix": "F", "ticketTypeId": "{{TICKET_TYPE_ID}}" }] }` |
| Status | `200 OK` |
| Response | `{ "addedSeats": 20 }` |

---

### TC-SEAT-08 — Thêm zone vào ZONE model đã có

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/events/{{EVENT_ID}}/seats` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "addZones": [{ "name": "Zone Premium", "capacity": 500, "ticketTypeId": "{{TICKET_TYPE_ID}}" }] }` |
| Điều kiện | Event dùng model ZONE |
| Status | `200 OK` |
| Response | `{ "addedZones": 1 }` |

---

## Module: Organizer

### TC-ORG-01 — Xem profile organizer

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/organizer/profile` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "id": "uuid", "userId": "uuid", "orgName": "IUH Events", "description": null, "logoUrl": null, "bannerUrl": null, "website": null, "contactEmail": null, "contactPhone": null, "status": "PENDING", "createdAt": "...", "updatedAt": "..." }` |

---

### TC-ORG-02 — Cập nhật profile organizer

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/organizer/profile` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "description": "Chuyên tổ chức các sự kiện âm nhạc", "contactPhone": "0901234567", "website": "https://iuhevents.vn" }` |
| Status | `200 OK` |
| Response | `{ "id": "uuid", ..., "description": "Chuyên tổ chức các sự kiện âm nhạc", "contactPhone": "0901234567", "website": "https://iuhevents.vn", "status": "PENDING", ... }` |

---

### TC-ORG-03 — Đổi orgName → reset về PENDING

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| URL | `{{BASE_URL}}/organizer/profile` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Body (JSON) | `{ "orgName": "IUH Events New Name" }` |
| Status | `200 OK` |
| Response | `{ ..., "orgName": "IUH Events New Name", "status": "PENDING", "note": "Tên tổ chức đã thay đổi. Trạng thái đã được reset về PENDING và cần Admin duyệt lại." }` |

---

### TC-ORG-04 — Danh sách đơn hàng của event

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/organizer/events/{{EVENT_ID}}/orders` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "total": 0, "page": 1, "limit": 20, "items": [] }` |

---

### TC-ORG-05 — Danh sách đơn hàng có filter

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/organizer/events/{{EVENT_ID}}/orders?status=PAID&dateFrom=2026-05-01` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "total": 0, "page": 1, "limit": 20, "items": [] }` |

---

### TC-ORG-06 — Chi tiết đơn hàng không tồn tại

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/organizer/orders/00000000-0000-0000-0000-000000000000` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `404 Not Found` |
| Response | `{ "statusCode": 404, "message": "Đơn hàng không tồn tại", "path": "...", "timestamp": "..." }` |

---

### TC-ORG-07 — Thống kê event

| Thuộc tính | Giá trị |
|---|---|
| Method | `GET` |
| URL | `{{BASE_URL}}/organizer/events/{{EVENT_ID}}/stats` |
| Header | `Authorization: Bearer {{ORGANIZER_TOKEN}}` |
| Status | `200 OK` |
| Response | `{ "totalOrders": 0, "paidOrders": 0, "revenue": 0, "ticketTypes": [{ "id": "uuid", "name": "VIP", "quantity": 100, "sold": 0, "price": "500000" }], "seatCounts": { "AVAILABLE": 50 } }` |

---

## Module: Seat Lock (UC09)

> **Bối cảnh:** Module booking lõi — giành ghế nguyên tử qua Lua trên Redis (atomicity ở Lua, không phải application code), audit ghi Postgres sau. Yêu cầu `Authorization: Bearer {{TOKEN}}` cho cả 2 endpoint.
>
> **Chuẩn bị seat thật:**
> - Đã chạy xong TC-EVENT, TC-TICKET, TC-SEAT-02 (đã có 50 ghế A1..E10).
> - Mở Prisma Studio (`npx prisma studio`) → bảng `seats` → copy 5 `id` UUID khác nhau vào biến Postman:
>   - `SEAT_ID_1`, `SEAT_ID_2`, `SEAT_ID_3`, `SEAT_ID_4`, `SEAT_ID_5` (đủ chạm MAX=4)
> - Cần thêm 1 user nữa để test 409 SEAT_TAKEN — đăng ký user2 (TC-AUTH-02 + verify-otp) → login → lưu `TOKEN_2`.
> - Env vars cần có khi `npm run start:dev`: `MAX_SEATS_PER_USER=4`.

### TC-LOCK-01 — Khóa ghế thành công

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Status | `200 OK` |
| Response | `{ "lockId": "uuid", "seatId": "{{SEAT_ID_1}}", "expiresAt": "2026-05-21T13:21:00.000Z" }` |
| Ghi chú | `expiresAt` = now + 15 phút. Lưu `lockId` để dùng cho TC khác nếu cần. |
| Verify Redis | `KEYS lock:event:{{EVENT_ID}}:seat:{{SEAT_ID_1}}` → 1 key, value = userId của TOKEN, TTL ~900 |
| Verify DB | `SELECT * FROM seat_locks WHERE seat_id = '{{SEAT_ID_1}}'` → 1 row status=ACTIVE |

---

### TC-LOCK-02 — Khóa ghế đã bị người khác giữ (SEAT_TAKEN)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN_2}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | Chạy sau TC-LOCK-01 (ghế đang bị TOKEN giữ) |
| Status | `409 Conflict` |
| Response | `{ "statusCode": 409, "message": { "code": "SEAT_TAKEN", "message": "Seat ... is already locked by another user" }, "path": "/api/v1/booking/seats/.../lock", "timestamp": "..." }` |
| Verify | Lock key trên Redis vẫn thuộc về user 1, không bị overwrite |

---

### TC-LOCK-03 — Khóa lại chính ghế mình đang giữ (idempotent)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | Chạy sau TC-LOCK-01 (cùng user) |
| Status | `200 OK` |
| Response | `{ "lockId": "uuid", "seatId": "{{SEAT_ID_1}}", "expiresAt": "..." }` (lockId trùng row cũ) |
| Verify Redis | `SCARD held:event:{{EVENT_ID}}:user:<userId>` không tăng — vẫn = 1 |
| Verify DB | `SELECT count(*) FROM seat_locks WHERE seat_id='{{SEAT_ID_1}}' AND status='ACTIVE'` = 1 (không tạo row mới) |

---

### TC-LOCK-04 — Vượt giới hạn MAX_SEATS_PER_USER (TICKET_LIMIT_REACHED)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_5}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | TOKEN đã khóa thành công SEAT_ID_1..4 (đủ MAX=4) |
| Bước trước | Lock SEAT_ID_2, SEAT_ID_3, SEAT_ID_4 lần lượt → 200 OK |
| Status | `422 Unprocessable Entity` |
| Response | `{ "statusCode": 422, "message": { "code": "TICKET_LIMIT_REACHED", "message": "User ... reached the seat hold limit of 4" }, "path": "...", "timestamp": "..." }` |
| Verify Redis | `SCARD held:event:{{EVENT_ID}}:user:<userId>` = 4 (không tăng thành 5) |
| Verify Redis | `EXISTS lock:event:{{EVENT_ID}}:seat:{{SEAT_ID_5}}` = 0 (không tạo lock) |

---

### TC-LOCK-05 — Khóa ghế không có token

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Status | `401 Unauthorized` |
| Response | `{ "statusCode": 401, "message": "Token không hợp lệ hoặc đã hết hạn", "path": "...", "timestamp": "..." }` |

---

### TC-LOCK-06 — seatId không phải UUID hợp lệ

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/not-a-uuid/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": "Validation failed (uuid is expected)", "path": "...", "timestamp": "..." }` |

---

### TC-LOCK-07 — Thiếu eventId trong body

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{}` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": ["eventId must be a UUID"], "path": "...", "timestamp": "..." }` |

---

### TC-LOCK-08 — eventId không đúng định dạng UUID

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "abc" }` |
| Status | `400 Bad Request` |
| Response | `{ "statusCode": 400, "message": ["eventId must be a UUID"], ... }` |

---

### TC-LOCK-09 — Giải phóng ghế của mình thành công

| Thuộc tính | Giá trị |
|---|---|
| Method | `DELETE` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | Đã chạy TC-LOCK-01 (user đang giữ SEAT_ID_1) |
| Status | `204 No Content` |
| Response | _(rỗng)_ |
| Verify Redis | `EXISTS lock:event:{{EVENT_ID}}:seat:{{SEAT_ID_1}}` = 0 |
| Verify Redis | `SISMEMBER held:event:{{EVENT_ID}}:user:<userId> {{SEAT_ID_1}}` = 0 |
| Verify Redis | `SISMEMBER held:event:{{EVENT_ID}} {{SEAT_ID_1}}` = 0 |
| Verify DB | `SELECT status, released_at FROM seat_locks WHERE seat_id='{{SEAT_ID_1}}'` → status=RELEASED, released_at IS NOT NULL |

---

### TC-LOCK-10 — Giải phóng ghế không phải của mình (403)

| Thuộc tính | Giá trị |
|---|---|
| Method | `DELETE` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_2}}/lock` |
| Header | `Authorization: Bearer {{TOKEN_2}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | SEAT_ID_2 đang bị TOKEN giữ (không phải TOKEN_2) |
| Status | `403 Forbidden` |
| Response | `{ "statusCode": 403, "message": "You do not own a lock on this seat (or it has expired)", "path": "...", "timestamp": "..." }` |
| Verify Redis | Lock key trên SEAT_ID_2 vẫn còn, value vẫn = user 1 |

---

### TC-LOCK-11 — Giải phóng ghế đã hết hạn / chưa từng khóa (403)

| Thuộc tính | Giá trị |
|---|---|
| Method | `DELETE` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_5}}/lock` |
| Header | `Authorization: Bearer {{TOKEN}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | SEAT_ID_5 chưa từng được lock bởi user này |
| Status | `403 Forbidden` |
| Response | `{ "statusCode": 403, "message": "You do not own a lock on this seat (or it has expired)", ... }` |

---

### TC-LOCK-12 — Sau khi release, ghế có thể được khóa lại

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_1}}/lock` |
| Header | `Authorization: Bearer {{TOKEN_2}}` |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Điều kiện | Đã chạy TC-LOCK-09 (SEAT_ID_1 đã được giải phóng) |
| Status | `200 OK` |
| Response | `{ "lockId": "uuid-mới", "seatId": "{{SEAT_ID_1}}", "expiresAt": "..." }` |
| Verify DB | `SELECT count(*) FROM seat_locks WHERE seat_id='{{SEAT_ID_1}}'` → 2 rows (1 RELEASED, 1 ACTIVE) |

---

### TC-LOCK-13 — Double-booking 100 client cùng giành 1 ghế (concurrency)

| Thuộc tính | Giá trị |
|---|---|
| Method | `POST` (100 request đồng thời) |
| URL | `{{BASE_URL}}/booking/seats/{{SEAT_ID_3}}/lock` |
| Header | 100 token user khác nhau |
| Body (JSON) | `{ "eventId": "{{EVENT_ID}}" }` |
| Cách chạy | Postman Runner ×100 / hoặc script Node `Promise.all` / hoặc `k6` |
| Kết quả mong đợi | Đúng **1 request 200 OK**, **99 request 409 SEAT_TAKEN** |
| Verify Redis | `GET lock:event:{{EVENT_ID}}:seat:{{SEAT_ID_3}}` = 1 userId duy nhất |
| Verify DB | `SELECT count(*) FROM seat_locks WHERE seat_id='{{SEAT_ID_3}}' AND status='ACTIVE'` = 1 |
| Ghi chú | Đã được cover bởi `src/booking/seat-lock/seat-lock.integration.spec.ts` test 1. Chạy `npm test -- seat-lock.integration` để verify tự động. |

---

### Kiểm tra Redis key UC09

```powershell
docker exec -it concert_redis redis-cli -a redis

# Lock key — userId là value
KEYS lock:event:*:seat:*
GET lock:event:<eventId>:seat:<seatId>
TTL lock:event:<eventId>:seat:<seatId>   # còn ~900s

# Per-user set — số ghế user đang giữ
KEYS held:event:*:user:*
SMEMBERS held:event:<eventId>:user:<userId>
SCARD held:event:<eventId>:user:<userId>   # <= MAX_SEATS_PER_USER

# Per-event set — tất cả ghế đang bị giữ trong event (cho UC08)
SMEMBERS held:event:<eventId>
```

---

## Luồng test hoàn chỉnh (Happy Path)

Thực hiện theo đúng thứ tự:

```
── Bước 1: Setup user thường ──
1.  POST /auth/register                            → tạo user (email: user@example.com)
2.  [Lấy OTP từ terminal server]
3.  POST /auth/verify-otp                          → kích hoạt user
4.  POST /auth/login                               → lấy accessToken → lưu vào TOKEN
5.  GET  /users/me                                 → verify profile, roles=["USER"]
6.  PATCH /users/me                                → cập nhật fullName, phone

── Bước 2: Setup organizer (cần Prisma Studio) ──
7.  POST /auth/register (email: org@example.com)   → tạo user organizer
8.  [Lấy OTP từ terminal]
9.  POST /auth/verify-otp (email: org@example.com) → kích hoạt
10. [Prisma Studio] Thêm role ORGANIZER vào bảng roles
11. [Prisma Studio] Thêm vào user_roles: userId=org_user_id, roleId=organizer_role_id
12. [Prisma Studio] Thêm vào organizer_profiles: userId=org_user_id, orgName="IUH Events"
13. POST /auth/login (email: org@example.com)      → lấy ORGANIZER_TOKEN

── Bước 3: Tạo event và cấu hình ──
14. POST /events                                   → tạo event DRAFT (lưu EVENT_ID)
15. POST /events/:eventId/ticket-types (VIP)       → tạo ticket type (lưu VIP_TICKET_TYPE_ID)
16. POST /events/:eventId/ticket-types (General)   → tạo ticket type thứ 2
17. POST /events/:eventId/seats/seat-map           → tạo seat-map
    Body: { "sections": [{ "rows": 5, "seatsPerRow": 10, "ticketTypeId": "VIP_TICKET_TYPE_ID" }] }
18. GET  /events/:eventId/seats                    → kiểm tra 50 ghế AVAILABLE
19. PATCH /events/:eventId/seats                   → thêm section mới
    Body: { "addSections": [{ "rows": 3, "seatsPerRow": 10, "ticketTypeId": "VIP_TICKET_TYPE_ID" }] }

── Bước 4: Submit và verify ──
20. POST /events/:eventId/submit                   → submit, status → PENDING_APPROVAL
21. GET  /events                                   → event KHÔNG xuất hiện (chỉ ACTIVE mới public)
22. GET  /organizer/events/:eventId/stats          → xem thống kê (orders=0, seats=80 AVAILABLE)
23. GET  /organizer/profile                        → xem profile organizer

── Bước 5: Khóa ghế (UC09) ──
24. [Prisma Studio] Copy 5 seatId vào SEAT_ID_1..5
25. POST /booking/seats/{{SEAT_ID_1}}/lock         → 200, ghi nhận lockId, expiresAt
26. POST /booking/seats/{{SEAT_ID_1}}/lock (TOKEN_2)→ 409 SEAT_TAKEN
27. POST /booking/seats/{{SEAT_ID_2..4}}/lock      → 200, đủ MAX=4 ghế
28. POST /booking/seats/{{SEAT_ID_5}}/lock         → 422 TICKET_LIMIT_REACHED
29. DELETE /booking/seats/{{SEAT_ID_1}}/lock       → 204, lock được giải phóng
30. POST /booking/seats/{{SEAT_ID_1}}/lock (TOKEN_2)→ 200, ghế lock lại được

── Bước 6: Security test ──
31. POST /auth/logout                              → logout user (TOKEN cũ)
32. GET  /users/me (TOKEN cũ)                      → expect 401 (blacklisted)
```

---

## Kiểm tra Redis và DB trực tiếp

```powershell
# Kết nối Redis CLI
docker exec -it concert_redis redis-cli

# Xem OTP đang có trong Redis
KEYS otp:*
GET otp:user@example.com
# → "123456:0"  (code:attempts)

# Xem blacklist token sau logout
KEYS blacklist:token:*
TTL blacklist:token:<jti>

# Xem login fail counter
KEYS login:fail:*
GET login:fail:user@example.com

# Xem resend OTP counter
KEYS otp:resend:*
```

```powershell
# Mở Prisma Studio để xem DB trực quan
npx prisma studio
# Truy cập: http://localhost:5555
```

---

## Ghi chú quan trọng

| Điểm | Mô tả |
|---|---|
| OTP source | Lấy từ terminal `npm run start:dev` — dòng `[DEV OTP] email → code` |
| ORGANIZER_TOKEN | Cần seed DB thủ công qua Prisma Studio trước khi test module Events/Organizer |
| Event public | Chỉ event có `status=ACTIVE` mới xuất hiện ở `GET /events` — Admin cần duyệt (chưa implement) |
| Ticket price | Trả về dạng `string` decimal từ Prisma, ví dụ `"500000"` không phải `500000` |
| UUID test | Dùng `00000000-0000-0000-0000-000000000000` để test 404, không dùng string ngẫu nhiên |
| Seat Lock env | `MAX_SEATS_PER_USER=4` trong `.env` — đổi giá trị này thì TC-LOCK-04 phải đổi theo |
| Seat Lock TTL | 900 giây (15 phút) cứng trong code, không qua env |
| Seat Lock atomicity | Acquire + Release đều là 1 Lua EVAL — không thể tách ra để test riêng bằng API |
| Swagger | `http://localhost:3000/api/docs` — đã bật từ task seat-lock |
