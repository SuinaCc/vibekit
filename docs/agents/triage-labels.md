# Triage Labels

Skills 使用五个 canonical triage roles。这个文件把这些 roles 映射到此 repo 实际使用的中文标签。

| Canonical role | 中文标签 | 含义 |
| -------------- | -------- | ---- |
| `needs-triage` | **待评估** | 维护者需要评估此 issue |
| `needs-info` | **等回复** | 等待 issue 提交者补充信息 |
| `ready-for-agent` | **AI就绪** | 规格完整，AI agent 可以独立领取开发 |
| `ready-for-human` | **人工处理** | 需要人工实现 |
| `wontfix` | **不处理** | 不会处理 / 已拒绝 |

当某个 skill 提到 role（例如 "apply the AFK-ready triage label"）时，使用此表中对应的中文标签。

## 状态机流转

```
Incoming issue → 待评估
                    ↓
              ┌─────┴─────┐
              ↓           ↓
           等回复      AI就绪 → 人工处理 → ✅ done
              ↓           ↓        ↑
           等回复     人工处理 → ↗
              ↓
           不处理 → ❌ closed
```
