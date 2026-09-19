# ADR 0001: 数据层采用嵌入式 PGlite + pgvector

- 状态：已接受
- 日期：2026-09-19
- 关联设计：[2026-09-19-foundation.md](../design/2026-09-19-foundation.md)

## 背景

单机环境无 Docker、无外部数据库服务，需要：关系存储（会话/消息/知识库元数据）+ 向量检索（RAG）。

选项：
1. **PGlite + pgvector**（WASM 嵌入式 Postgres）
2. SQLite + sqlite-vec（better-sqlite3 原生编译）
3. 外部 Postgres + pgvector（要求常备 Docker）

## 决策

采用 PGlite + pgvector（`@electric-sql/pglite` + `@electric-sql/pglite-pgvector`）。

## 理由

- 零外部服务、零原生编译（纯 WASM），Node 22 直接跑。
- 真 Postgres 语义（JSONB、事务、pgvector 余弦检索），未来换外部 Postgres 时 SQL 不用改。
- 单写单用户场景下性能足够。

## 后果

- 正面：部署极简（单容器/单进程）；数据目录即全部状态，备份 = 拷贝目录。
- 负面：单连接串行查询，并发能力弱；不能多副本扩容（k8s 只能 1 副本）；Next.js 中需配置 webpack externals 避免打包其 WASM/tar 资源（见 `apps/web/next.config.ts`）。
- 缓解：数据访问全部收敛在 `packages/data`，未来可整体替换为外部 Postgres 而不动上层。
