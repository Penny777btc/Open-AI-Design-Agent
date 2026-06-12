"""画布自动摆放：按行排布（每行 4 张、间距 24px），新批次落在已有内容包围盒下方。

坐标是画布世界坐标。显示尺寸模拟前端 addImage 的缩放规则：
自然尺寸等比缩到 maxDim=400 再减半（即最长边 200px）。
"""

ROW_CAP = 4
GAP = 24
NEW_BATCH_GAP = 48
MAX_DIM = 400


def display_size(width: int | None, height: int | None) -> tuple[int, int]:
    w, h = width or 1024, height or 1024
    if w >= h:
        scaled = (MAX_DIM, h / w * MAX_DIM)
    else:
        scaled = (w / h * MAX_DIM, MAX_DIM)
    return int(scaled[0] / 2), int(scaled[1] / 2)


class PlacementPlanner:
    """单个 job 内的顺序摆放器（调用方需持有 session 级锁保证串行）。"""

    def __init__(self, canvas_nodes: list[dict] | None, viewport: dict | None = None):
        nodes = [n for n in (canvas_nodes or []) if isinstance(n, dict) and "x" in n]
        if nodes:
            self.origin_x = min(n["x"] for n in nodes)
            self.cursor_y = max(n["y"] + (n.get("h") or 200) for n in nodes) + NEW_BATCH_GAP
        else:
            # 空画布：以用户当前视口中心为排布原点（否则落在世界原点=视口左上角）
            self.origin_x, self.cursor_y = self._viewport_center(viewport)
        self.cursor_x = self.origin_x
        self.col = 0
        self.row_height = 0

    @staticmethod
    def _viewport_center(viewport: dict | None) -> tuple[int, int]:
        try:
            zoom = viewport.get("zoom") or 1
            pan = viewport.get("pan") or [0, 0]
            w, h = viewport.get("w") or 0, viewport.get("h") or 0
            if w and h:
                center_x = (-pan[0] + w / 2) / zoom
                center_y = (-pan[1] + h / 2) / zoom
                # 原点 = 中心往左上偏移一张图的显示尺寸，让首图大致居中
                return int(center_x - MAX_DIM / 4), int(center_y - MAX_DIM / 4)
        except (AttributeError, TypeError, ZeroDivisionError, IndexError):
            pass
        return 0, 0

    def next(self, width: int | None, height: int | None) -> tuple[int, int]:
        disp_w, disp_h = display_size(width, height)
        if self.col >= ROW_CAP:
            self.col = 0
            self.cursor_x = self.origin_x
            self.cursor_y += self.row_height + GAP
            self.row_height = 0
        x, y = int(self.cursor_x), int(self.cursor_y)
        self.cursor_x += disp_w + GAP
        self.row_height = max(self.row_height, disp_h)
        self.col += 1
        return x, y
