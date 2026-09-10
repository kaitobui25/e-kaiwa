# AGENTS.md

Scope: toàn bộ repository E-KAIWA.

## Core engineering rules

- Ưu tiên clean code, responsibility rõ ràng, module hóa vừa đủ.
- Tránh overengineering và dependency/framework không cần thiết.
- Giữ code dễ đọc, dễ test, dễ bảo trì, dễ nâng cấp.
- Tối ưu cho VPS nhỏ (~1 GB RAM): tránh worker/process thừa, polling quá dày, test song song gây peak RAM, hoặc runtime service không cần thiết.
- Không phá flow realtime/Gemini đang ổn định nếu task không yêu cầu.
- Khi thay đổi behavior quan trọng, cập nhật test/documentation liên quan.

## App version — single source of truth

Canonical app version nằm tại:

```text
src/e_kaiwa/__init__.py
```

Dạng hiện tại:

```python
__version__ = "..."
```

Rules:

1. `src/e_kaiwa/__init__.py::__version__` là nguồn app release version duy nhất.
2. Không tạo thêm root `VERSION`, frontend version constant, updater counter, hoặc source version thứ hai.
3. `config.yaml version` là config/settings schema version; không được dùng làm app release version.
4. Frontend/health/update status chỉ đọc/derive app version từ canonical source trên; không hardcode duplicate.
5. Updater/deployment chỉ đọc version của revision đang deploy. Updater tuyệt đối không tự tăng hoặc tự ghi version.
6. Git revision/commit SHA quyết định code mới/cũ; version có thể giữ nguyên qua nhiều commits.

## Mandatory version-bump question

Mỗi khi một task **thực sự sửa source/production code**, trước khi kết thúc task hoặc commit thay đổi, agent phải hỏi user:

> Có muốn tăng app version không?

Không tự tăng version trước khi có câu trả lời.

- Nếu user **không đồng ý** hoặc chưa trả lời: giữ nguyên `__version__`.
- Nếu user **đồng ý**: tăng `src/e_kaiwa/__init__.py::__version__` theo version scheme mà user đang dùng/chỉ định trong task đó.
- Nếu user đưa version cụ thể, dùng đúng version user yêu cầu.
- Không suy diễn rằng mọi commit đều cần version mới.
- Không hỏi version bump cho thay đổi chỉ gồm docs, `.agent/`, plan, log, note, comment-only hoặc metadata không ảnh hưởng source/runtime, trừ khi user yêu cầu.

## Current planning override

Nếu tài liệu cũ trong `.agent/chatgptplan/` còn ghi canonical version là root file `VERSION`, coi wording đó là **superseded** bởi quyết định trong file này:

```text
src/e_kaiwa/__init__.py::__version__
```

Khi chỉnh các plan đó trong tương lai, phải đồng bộ lại theo rule này.
