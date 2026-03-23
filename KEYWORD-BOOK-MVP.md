# 关键词长篇项目 MVP 运行说明

这是基于现有 `ProjectEngine` / `API routes` / `projects-state.json` 扩展出来的第一阶段 MVP。

## 已实现闭环

1. 输入关键词
2. 生成 3 个候选方案
3. 用户选择其中一个方案
4. 确认目标字数（默认 500000）
5. 创建项目
6. 自动生成：项目扩展 -> 章节概要 -> 逐章生成 -> 基础检查与修订 -> 完结报告
7. 通过项目摘要接口查看累计字数与是否达标

## API

### 1. 生成候选方案

```bash
curl -X POST http://localhost:3847/api/keyword-book/candidates \
  -H 'Content-Type: application/json' \
  -d '{"keyword":"赛博修仙"}'
```

### 2. 选择候选并创建项目

把上一步返回的某个 `candidate` 原样放入 `selectedCandidate`。

```bash
curl -X POST http://localhost:3847/api/keyword-book/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "keyword":"赛博修仙",
    "title":"赛博修仙：灵网飞升",
    "targetWords":500000,
    "targetWordsPerChapter":4000,
    "selectedCandidate":{
      "id":"candidate-1",
      "title":"赛博修仙：灵网飞升",
      "hook":"示例 hook",
      "premise":"示例 premise",
      "audience":"示例 audience",
      "highlights":["卖点1","卖点2","卖点3"]
    }
  }'
```

### 3. 启动并自动执行

```bash
curl -X POST http://localhost:3847/api/projects/PROJECT_ID/auto-execute
```

### 4. 查看累计字数摘要

```bash
curl http://localhost:3847/api/keyword-book/projects/PROJECT_ID/summary
```

## 说明

- 如果没有配置 AI Key，候选方案接口会回退到内置候选模板。
- 真正执行章节生成 / 修订步骤仍需要可用 AI provider。
- 项目状态会持久化到：`workspace/.config/projects-state.json`
