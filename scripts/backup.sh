#!/usr/bin/env bash
# scripts/backup.sh — Picsmith 数据库 + 上传文件在线一致性备份
#
# 为什么用 sqlite3 ".backup" 而不是直接 cp：
#   SQLite 的 WAL 模式下写事务可能还在进行，直接 cp 会得到一个不一致的快照。
#   ".backup" 命令走的是 SQLite Online Backup API，能在写入过程中安全复制。
#
# 用法：
#   bash scripts/backup.sh              # 从仓库根目录运行
#   DB_PATH=/other/path/dev.db bash scripts/backup.sh   # 覆盖数据库路径
#
# 产物：backups/picsmith-YYYYmmdd-HHMMSS.tar.gz
#
# Crontab 示例（每日 04:00 运行，日志追加到 backups/backup.log）：
#   0 4 * * * cd /path/to/Open-AI-Design-Agent && bash scripts/backup.sh >> backups/backup.log 2>&1

set -euo pipefail

# ── 路径配置 ────────────────────────────────────────────────────────────────
# REPO_ROOT：脚本的上一级目录，即仓库根目录
# 允许从任意工作目录调用，不依赖 $PWD
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# 数据库路径：可被环境变量 $DB_PATH 覆盖，便于 CI / Docker 里使用不同路径
DB_PATH="${DB_PATH:-"$REPO_ROOT/server/dev.db"}"

# 上传文件目录：从 server/app/config.py 中确认，storage_dir 默认值为 server/storage
STORAGE_DIR="$REPO_ROOT/server/storage"

# 备份输出目录
BACKUP_DIR="$REPO_ROOT/backups"

# 保留最近 N 份，更旧的自动删除
KEEP_LAST=7

# ── 时间戳 ──────────────────────────────────────────────────────────────────
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_NAME="picsmith-${TIMESTAMP}"
WORK_DIR="$(mktemp -d)"       # 临时工作目录，脚本退出时清理
DB_COPY="$WORK_DIR/dev.db"    # 数据库在线备份的落点

# ── 清理钩子：无论成功或失败都删除临时目录 ──────────────────────────────────
trap 'rm -rf "$WORK_DIR"' EXIT

# ── 前置检查 ────────────────────────────────────────────────────────────────
if [[ ! -f "$DB_PATH" ]]; then
  echo "[backup] 错误：数据库文件不存在：$DB_PATH" >&2
  exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
  echo "[backup] 错误：sqlite3 未安装，请先 brew install sqlite 或 apt install sqlite3" >&2
  exit 1
fi

if ! command -v tar &>/dev/null; then
  echo "[backup] 错误：tar 命令不存在" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── 第一步：SQLite 在线一致性备份 ───────────────────────────────────────────
echo "[backup] 开始数据库在线备份：$DB_PATH -> $DB_COPY"
# ".backup" 命令通过 SQLite Online Backup API 复制，安全跨越并发写入
if ! sqlite3 "$DB_PATH" ".backup '$DB_COPY'"; then
  echo "[backup] 错误：数据库备份失败" >&2
  exit 1
fi
echo "[backup] 数据库备份完成"

# ── 第二步：打包 db 备份 + 上传目录 ─────────────────────────────────────────
DEST_TAR="$BACKUP_DIR/${BACKUP_NAME}.tar.gz"
echo "[backup] 打包备份产物 -> $DEST_TAR"

# 构建 tar 参数：db 副本必须包含；storage 目录不存在时跳过（全新部署可能还没有上传文件）
TAR_TARGETS=("$DB_COPY")
if [[ -d "$STORAGE_DIR" ]]; then
  TAR_TARGETS+=("$STORAGE_DIR")
  echo "[backup] 包含上传文件目录：$STORAGE_DIR"
else
  echo "[backup] 上传文件目录不存在，跳过：$STORAGE_DIR"
fi

# -C $REPO_ROOT 让 tar 以仓库根为基准，归档路径更短、可读
# db 副本在临时目录，单独用绝对路径传入
if ! tar -czf "$DEST_TAR" \
    --exclude="$STORAGE_DIR/.gitkeep" \
    -C "$(dirname "$DB_COPY")" "$(basename "$DB_COPY")" \
    $( [[ -d "$STORAGE_DIR" ]] && echo "-C $REPO_ROOT server/storage" ); then
  echo "[backup] 错误：打包失败" >&2
  exit 1
fi
echo "[backup] 打包完成：$DEST_TAR ($(du -sh "$DEST_TAR" | cut -f1))"

# ── 第三步：保留最近 KEEP_LAST 份，删除更旧的 ───────────────────────────────
# 按文件名排序（YYYYmmdd-HHMMSS 格式保证字典序 = 时间序），取最旧的删掉
EXISTING=($(ls -1 "$BACKUP_DIR"/picsmith-*.tar.gz 2>/dev/null | sort))
TOTAL="${#EXISTING[@]}"
if (( TOTAL > KEEP_LAST )); then
  DELETE_COUNT=$(( TOTAL - KEEP_LAST ))
  echo "[backup] 删除 $DELETE_COUNT 份旧备份（保留最近 $KEEP_LAST 份）"
  for f in "${EXISTING[@]:0:$DELETE_COUNT}"; do
    rm -f "$f"
    echo "[backup]   已删除：$f"
  done
fi

echo "[backup] 备份成功完成：$DEST_TAR"
