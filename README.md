# Claude Code kết hợp ChatGPT (Claude Code with ChatGPT)

> ChatGPT suy nghĩ. Claude Code thực thi.  
> ChatGPT thinks. Claude Code works.

> [!IMPORTANT]
> **Gặp sự cố?** Hãy chạy `c2c doctor` hoặc nhập `/chatgpt-collab doctor` bên trong Claude Code.

---

## Vấn đề cần giải quyết

Các gói thuê bao ChatGPT Pro, Business, Enterprise và Edu cung cấp năng lực suy luận bậc cao cùng khả năng kết nối MCP (Model Context Protocol) tùy chỉnh cho nhà phát triển (tùy thuộc vào chính sách quản trị của tổ chức trên Business/Enterprise/Edu và tính khả dụng của Developer Mode trên Pro). Tuy nhiên, các AI coding agent cục bộ thường tiêu tốn lượng token API đắt đỏ cho việc lập kế hoạch kiến trúc, phân rã công việc và đánh giá mã nguồn (code review).

Dự án này điều hướng toàn bộ phần suy luận và lập kế hoạch kiến trúc phức tạp sang giao diện web của ChatGPT, trong khi Claude Code CLI đảm nhiệm việc chỉnh sửa mã nguồn, chạy kiểm thử và quản lý git ngay tại máy cục bộ của bạn.

Đối với người dùng ChatGPT Plus và Free (chưa được OpenAI hỗ trợ kết nối MCP tùy chỉnh), hệ thống cung cấp chế độ chuyển giao ngữ cảnh thủ công an toàn và trung thực (**Mode P**).

---

## Dự án này là gì?

Biến ChatGPT Web thành trợ lý lập kế hoạch kiến trúc và đánh giá mã nguồn (review co-pilot) cho các phiên làm việc của Claude Code, trong khi quyền thực thi cục bộ 100% thuộc về Claude Code.

- **Dành cho ChatGPT Pro / Business / Enterprise / Edu (Chế độ MCP)**: ChatGPT chỉ truy vấn chính xác các tệp, diff và kết quả tìm kiếm cần thiết theo nhu cầu thông qua kết nối Model Context Protocol (MCP) **hoàn toàn chỉ đọc (strictly read-only)** được bảo vệ bằng OAuth 2.1 (tùy thuộc vào gói thuê bao và quyền quản trị).
- **Dành cho ChatGPT Plus / Free (Mode P — Chuyển giao ngữ cảnh cục bộ thủ công)**: Claude Code tạo ra các gói ngữ cảnh và gói đánh giá (review bundle) có giới hạn dung lượng nghiêm ngặt, mang tính xác định và đã được khử dữ liệu nhạy cảm để dán trực tiếp vào ChatGPT Plus (giảm thiểu rủi ro lộ bí mật thông qua chặn tệp nhạy cảm, giới hạn đường dẫn và tự động che giấu các khóa bí mật đã biết).

**Động cơ thực thi độc lập nhà cung cấp (Provider-Agnostic Executor)** — Claude Code đóng vai trò là công cụ thực thi cục bộ và có thể được cấp quyền bằng bất kỳ nhà cung cấp mô hình nào (Anthropic, 9Router, Google Gemini, Amazon Bedrock, Google Vertex AI hoặc proxy nội bộ) mà không ảnh hưởng đến kiến trúc C2C Bridge.

---

## Kiến trúc hệ thống

```
                 ┌───────────────────────────────────────────────┐
                 │          ChatGPT Web / Projects               │
                 │      (Suy luận / Lập kế hoạch / Đánh giá)     │
                 └───────────────┬───────────────────────▲───────┘
                                 │                       │
                    Mặt phẳng dữ │                       │ Mặt phẳng điều khiển (<1 KB)
                    liệu MCP     │                       │ Mode C: Chuyển giao có hướng dẫn
            (Streamable HTTP + OAuth 2.1)                │ Mode A: Script tự động (tùy chọn)
                                 ▼                       │
                 ┌───────────────────────────────────────┴───────┐
                 │            C2C Bridge Daemon                  │
                 │  - Loopback HTTP (127.0.0.1:48765)            │
                 │  - OAuth 2.1 AS + PKCE (RFC 8414 / RFC 7591)  │
                 │  - Quản lý mã ghép nối một lần CSPRNG         │
                 │  - 9 công cụ MCP hoàn toàn chỉ đọc            │
                 │  - Cloudflare Tunnel (Quick / Named)          │
                 │  - Gia cố bảo mật đường dẫn Windows & POSIX   │
                 └───────────────────────┬───────────────────────┘
                                         │
                   Đường dẫn chuẩn hóa   │ Giới hạn chỉ đọc
                   Không phân biệt hoa/th│
                   Chặn NTFS Data Stream │
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │               Thư mục làm việc                │
                 │   (Mã nguồn, kho lưu trữ git, .c2cignore)     │
                 └───────────────────────▲───────────────────────┘
                                         │
                     Sửa tệp / Shell     │ Git Commits / Kiểm thử
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │            Claude Code CLI Harness            │
                 │  - .claude/skills/chatgpt-collab/SKILL.md     │
                 │  - Lệnh Slash gốc: /chatgpt-collab            │
                 │  - Động cơ thực thi không phụ thuộc model     │
                 └───────────────────────────────────────────────┘
```

- **Tách biệt hai mặt phẳng (Dual-Plane Separation)**:
  - **Mặt phẳng điều khiển (Control Plane)**: Claude Code và ChatGPT trao đổi các thông điệp trạng thái `[C2C]` tối giản và có cấu trúc (`INIT → PLAN → EXECUTED → REVIEW → DONE`). Trong Chế độ MCP, các thông điệp trạng thái này có dung lượng dưới 1 KB và không dán trực tiếp nội dung tệp, nhật ký hay diff `[MCP-Mode-Only]`. Trong Mode P, các gói ngữ cảnh được kiểm soát dung lượng và khử dữ liệu nhạy cảm theo ngân sách byte nghiêm ngặt.
  - **Mặt phẳng dữ liệu (Data Plane - MCP chỉ đọc)**: ChatGPT truy vấn cấu trúc thư mục, tệp mã nguồn, git diff và kết quả kiểm thử theo nhu cầu thông qua 9 công cụ MCP chỉ đọc (`workspace_info`, `list_directory`, `read_file`, `search_workspace`, `git_status`, `git_diff`, `test_status`, `execution_summary`, `execution_output`).
- **Vòng lặp xác minh độc lập (Independent Verification Loop)**: Sau khi Claude Code hoàn thành thay đổi, ChatGPT kiểm tra trực tiếp git diff thực tế và lịch sử thực thi đã qua khử trùng qua MCP (hoặc qua gói review diff trong Mode P) thay vì chỉ tin cậy kết quả báo cáo của máy cục bộ.

---

## Cài đặt bằng một đoạn văn (One-Paste Install)

Chọn câu lệnh (prompt) phù hợp với gói thuê bao ChatGPT của bạn để dán vào Claude Code:

### Luồng A: Chế độ MCP (ChatGPT Pro / Business / Enterprise / Edu)
```text
Hãy cài đặt và cấu hình "claude-code-with-chatgpt" cho Chế độ MCP:

1. Kiểm tra môi trường: Đảm bảo git, Node.js >= 20 và cloudflared đã được cài đặt (macOS: brew install cloudflared, Windows: winget install Cloudflare.cloudflared).
2. Tải mã nguồn & Build: Clone https://github.com/dinhvien04/claude-code-with-chatgpt.git vào thư mục ~/claude-code-with-chatgpt (hoặc git pull nếu đã tồn tại), sau đó chạy `corepack pnpm install` và `corepack pnpm build`.
3. Thiết lập Skill & Quyền: Sao chép thư mục .claude/skills/chatgpt-collab vào thư mục làm việc hiện tại (.claude/skills/chatgpt-collab) hoặc toàn cục (~/.claude/skills/chatgpt-collab). Chạy `c2c config-allow -w .` trong thư mục làm việc để tự động cấp quyền và thiết lập đường dẫn ghi trạng thái sandbox trong .claude/settings.local.json.
4. Khởi động dịch vụ: Chạy `c2c setup -w .` để khởi chạy tiến trình bridge daemon cục bộ cùng tunnel, lấy URL MCP công khai và mã ghép nối một lần.
5. Hướng dẫn ghép nối trên ChatGPT Web: Vào Cài đặt (Settings) -> Apps (hoặc Developer Mode) -> Thêm App tùy chỉnh / Connector và điền URL MCP.
6. Xác minh kết nối và hiển thị danh sách kiểm tra hoàn tất.
```

### Luồng B: Mode P (ChatGPT Plus / Free — 100% Cục bộ, không cần cloudflared / daemon)
```text
Hãy cài đặt và cấu hình "claude-code-with-chatgpt" cho Mode P (Chuyển giao ngữ cảnh thủ công cục bộ):

1. Kiểm tra môi trường: Đảm bảo git và Node.js >= 20 đã sẵn sàng (KHÔNG cần cài đặt cloudflared hay mở tunnel).
2. Tải mã nguồn & Build: Clone https://github.com/dinhvien04/claude-code-with-chatgpt.git vào thư mục ~/claude-code-with-chatgpt (hoặc git pull nếu đã tồn tại), sau đó chạy `corepack pnpm install` và `corepack pnpm build`.
3. Thiết lập Skill & Quyền: Sao chép thư mục .claude/skills/chatgpt-collab vào .claude/skills/chatgpt-collab (hoặc toàn cục ~/.claude/skills/chatgpt-collab). Chạy `c2c config-allow -w .` trong thư mục làm việc.
4. Xác minh Mode P sẵn sàng hoạt động (thông qua lệnh `c2c bundle plan` và `/chatgpt-collab --mode-p <mục_tiêu>`), không cần khởi chạy daemon hay tunnel ngầm.
```

---

## Hướng dẫn nhanh & Sử dụng

### 1. Cài đặt chung
```bash
# Clone kho lưu trữ
git clone https://github.com/dinhvien04/claude-code-with-chatgpt.git ~/claude-code-with-chatgpt
cd ~/claude-code-with-chatgpt

# Cài đặt phụ thuộc và biên dịch dự án
corepack pnpm install
corepack pnpm build

# Liên kết lệnh CLI toàn cục (tùy chọn)
npm link
```

### 2. Lựa chọn luồng làm việc

```
                         CÀI ĐẶT CHUNG
                               │
          ┌────────────────────┴────────────────────┐
          ▼                                         ▼
   Tùy chọn A: Mode P                        Tùy chọn B: Chế độ MCP
 (ChatGPT Plus / Free)                 (Pro / Business / Enterprise / Edu)
          │                                         │
   100% CLI Cục bộ                           c2c config-allow -w .
   Không cần cloudflared                     c2c setup -w .
   Không cần bridge daemon                   Cloudflare Tunnel
   Không cần ghép nối OAuth                  Ghép nối OAuth trên ChatGPT
```

---

### Tùy chọn A: Mode P (ChatGPT Plus / Free — 100% Cục bộ, không daemon / tunnel)

*Lưu ý: OpenAI hiện tại giới hạn kết nối MCP tùy chỉnh cho các gói Pro, Business, Enterprise và Edu. Nếu dùng ChatGPT Plus hoặc Free, Mode P hoạt động 100% trên máy cục bộ, không cần cloudflared, không tunnel, không daemon và không yêu cầu cấu hình mạng phức tạp.*

1. Trong Claude Code CLI, chạy `/chatgpt-collab --mode-p <mục_tiêu>` hoặc tạo gói lập kế hoạch trực tiếp:
   ```bash
   c2c bundle plan -w . --goal "Xây dựng tính năng xác thực" --files "src/index.ts,src/app.ts"
   ```
2. Dán gói `[C2C] STATE: INIT_P` đã tạo vào ChatGPT Plus. ChatGPT sẽ phản hồi lại thông điệp `[C2C] STATE: PLAN`.
3. Claude Code tiến hành chỉnh sửa mã nguồn và chạy kiểm thử tại máy cục bộ.
4. Tạo gói đánh giá (mặc định ở chế độ `head`, bao gồm toàn bộ thay đổi staged, unstaged và untracked an toàn kèm hỗ trợ phân trang chunking):
   ```bash
   c2c bundle review -w . --task c2c_0123456789abcdef --iteration 1
   ```
5. Dán gói `[C2C] STATE: EXECUTED_P` vào ChatGPT Plus để đánh giá. Nếu thay đổi lớn và được chia thành nhiều phần (`REVIEW_CHUNK: 1/N`), tiếp tục tạo các phần kế tiếp bằng `--chunk <n>` cho đến khi `REVIEW_COMPLETE: true`.

---

### Tùy chọn B: Chế độ MCP (ChatGPT Pro / Business / Enterprise / Edu)

1. Cấu hình quyền trong thư mục làm việc mục tiêu:
   ```bash
   c2c config-allow -w .
   ```
2. Khởi tạo daemon cầu nối và Cloudflare tunnel:
   ```bash
   c2c setup -w .
   ```
   Lệnh sẽ xuất ra URL MCP công khai (ví dụ: `https://xxx.trycloudflare.com/mcp`), mã ghép nối 8 ký tự và tên ứng dụng kết nối.
3. Mở ChatGPT Web -> **Cài đặt (Settings)** -> **Apps** -> **Cài đặt nâng cao (Advanced Settings)** (hoặc **Developer Mode**).  
   *(Lưu ý: MCP tùy chỉnh trên Business, Enterprise, Edu cần được quản trị viên cấp quyền; trên Pro cần bật Developer Mode nếu khả dụng).*
4. Chọn **Thêm App tùy chỉnh / Connector (Add Custom App / Connector)**:
   - **Tên (Name)**: `Claude Code with ChatGPT`
   - **URL Máy chủ (Server URL)**: `https://...trycloudflare.com/mcp`
   - **Xác thực (Authentication)**: `OAuth`
5. Nhấn **Kết nối (Connect)** / **Ủy quyền (Authorize)**, nhập mã ghép nối 8 ký tự và xác nhận.
6. Trong hội thoại ChatGPT, gửi lời nhắc khởi động (**Boot Prompt**: `/chatgpt-collab boot`) và chọn hoặc `@nhắc_đến` ứng dụng connector trong câu hỏi.

---

### 3. Thực hiện một nhiệm vụ
Trong Claude Code CLI:
```text
/chatgpt-collab Xây dựng hệ thống xác thực người dùng bằng JWT và refresh token
```
Claude Code sẽ định dạng câu lệnh `[C2C] STATE: INIT` cho ChatGPT. Dán phản hồi `[C2C] STATE: PLAN` từ ChatGPT vào Claude Code để Claude Code tự động thực thi, chạy kiểm thử và yêu cầu review.

*(Tùy chọn Mode A)*: Nếu bạn muốn tự động hóa thao tác trình duyệt bên ngoài, script `node scripts/browser-agent.mjs` có thể tự động chuyển giao prompt khi được cấu hình.

---

## Mô hình bảo mật

- **MCP Hoàn toàn chỉ đọc**: Máy chủ bridge tuyệt đối không cung cấp công cụ ghi tệp, xóa tệp, chạy lệnh shell hay thay đổi git. Prompt injection không thể gây ra hành động phá hoại.
- **Kiểm soát đường dẫn nghiêm ngặt**: Chuẩn hóa đường dẫn thực tế (canonical realpaths) từ thư mục gốc; loại bỏ hoàn toàn các nỗ lực vượt quyền (`../`), null bytes, Windows Alternate Data Streams (`::$DATA`), dấu hai chấm và khoảng trắng/dấu chấm ở cuối tên tệp.
- **Bảo vệ thông tin bí mật & Nhạy cảm**: Tự động từ chối truy cập khóa riêng tư (private keys), tệp `.env*` (ngoại trừ `.env.example`), token đám mây và thư mục nội bộ `.git/`.
- **Tự động khử dữ liệu nhạy cảm**: Nhật ký thực thi tự động làm sạch OpenAI project key (`sk-proj-...`), Anthropic key (`sk-ant-...`), Google API key (`AIza...`), header bearer token và đường dẫn thư mục cá nhân của người dùng.
- **OAuth 2.1 + PKCE**: Tất cả endpoint MCP đều bắt buộc xác thực bearer tuân thủ chuẩn RFC 8414 và RFC 7591. Mã ghép nối tạm thời được tạo bằng CSPRNG (hết hạn sau 5 phút, giới hạn 5 lần thử sai).

Để xem chi tiết phân tích mối đe dọa và các cam kết ranh giới bảo mật, vui lòng đọc [docs/security.md](docs/security.md).

---

## Tra cứu lệnh CLI & Hướng dẫn phát triển

```bash
# Các lệnh vòng đời cốt lõi
c2c setup           # Khởi động bridge daemon, tunnel và tạo mã ghép nối
c2c status          # Kiểm tra trạng thái daemon, tunnel và kết nối
c2c doctor          # Chẩn đoán lỗi hệ thống và tự động sửa chữa
c2c pair            # Tạo mã ghép nối 8 ký tự mới
c2c unpair          # Thu hồi toàn bộ token OAuth cho thư mục làm việc
c2c stop            # Dừng daemon chạy ngầm và tunnel
c2c logs            # Xem nhật ký hoạt động của bridge (--verbose để xem chi tiết)

# Mode P (Chuyển giao cục bộ an toàn cho Plus / Free)
c2c bundle plan     # Tạo gói ngữ cảnh lập kế hoạch [C2C] STATE: INIT_P
c2c bundle review   # Tạo gói đánh giá mã nguồn [C2C] STATE: EXECUTED_P

# Cấu hình & Phân quyền
c2c config-allow    # Cấu hình quyền và đường dẫn ghi sandbox trong .claude/settings.local.json
c2c session         # Xem hoặc quản lý checkpoint nhiệm vụ hiện tại
c2c record          # Ghi nhận thủ công vòng lặp thực thi và kết quả kiểm thử
```

### Xây dựng và Kiểm thử dự án
```bash
pnpm install        # Cài đặt các gói phụ thuộc
pnpm build          # Biên dịch TypeScript sang thư mục dist/
pnpm test           # Chạy toàn bộ bộ kiểm thử Vitest (workspace, auth, mcp, security)
pnpm typecheck      # Kiểm tra kiểu nghiêm ngặt bằng TypeScript
```

---

## Liên kết tài liệu

- [Kiến trúc hệ thống (System Architecture)](docs/architecture.md)
- [Quy chuẩn giao thức C2C (C2C Protocol Specification)](docs/protocol.md)
- [Bảo mật & Mô hình mối đe dọa (Security & Threat Model)](docs/security.md)
- [Chẩn đoán & Xử lý sự cố (Troubleshooting & Diagnostics)](docs/troubleshooting.md)
- [Hướng dẫn chuyển đổi từ Claude Code (Claude Code Migration Guide)](docs/claude-code-port.md)

---

## Nguồn gốc dự án & Giấy phép

Dự án này là phiên bản kế thừa và chuyển đổi từ [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) nhằm tương thích tối ưu cho Claude Code CLI và hệ sinh thái Anthropic.

Phát hành theo giấy phép mã nguồn mở [MIT License](LICENSE).  
*Dự án cộng đồng phi chính thức. Không liên kết hay được xác nhận bởi Anthropic hoặc OpenAI.*
