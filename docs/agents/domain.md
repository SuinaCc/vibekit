# Domain Docs

Engineering skills 探索 codebase 时，应如何消费这个 repo 的 domain documentation。

## 探索前先读取

- repo 根目录的 **`CONTEXT.md`**（如果存在）— 项目的领域语言 glossary
- **`docs/adr/`** — 与你即将处理区域相关的架构决策记录

如果这些文件不存在，**静默继续**。不要标记缺失；不要提前建议创建。producer skill（`/grill-with-docs`）会在术语或决策实际被解决时懒创建它们。

## File structure

单上下文 (single-context)：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-plugin-sandbox.md
│   └── 0002-local-storage.md
├── src/
│   ├── main/
│   ├── preload/
│   ├── renderer/
│   └── shared/
└── plugins/
```

## 使用 glossary 中的词汇

当你的输出命名某个 domain concept 时（issue title、refactor proposal、hypothesis、test name），使用 `CONTEXT.md` 中定义的术语。不要漂移到 glossary 明确避免的同义词。

如果你需要的概念还不在 glossary 中，说明要么你正在发明项目未使用的语言（重新考虑），要么确实存在缺口（为 `/grill-with-docs` 记录）。

## 标记 ADR 冲突

如果你的输出与现有 ADR 矛盾，明确指出，而不是静默覆盖：

> _与 ADR-0001（插件沙箱隔离）矛盾 — 但值得重新讨论，因为…_
