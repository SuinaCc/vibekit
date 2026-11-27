# Issue tracker: Local Markdown

这个 repo 的 issues 和 PRDs 作为 markdown 文件存放在 `.scratch/` 中。

## Conventions

- 每个 feature 一个目录：`.scratch/<feature-slug>/`
- PRD 是 `.scratch/<feature-slug>/PRD.md`
- Implementation issues 是 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- Triage state 记录在每个 issue 文件顶部的 YAML frontmatter 中：

```yaml
---
status: 待评估  # 待评估 | 等回复 | AI就绪 | 人工处理 | 不处理
---
```

- Comments 和讨论追加到文件底部的 `## 讨论` heading 下

## When a skill says "publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下创建新文件（必要时创建目录）。

## When a skill says "fetch the relevant ticket"

读取引用路径处的文件。用户通常会直接传入路径或 issue number。
