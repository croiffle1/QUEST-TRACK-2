"""art/sheet.png 를 네 칸으로 자르고 바깥 흰 배경을 투명하게 해서 art/frame1~4.png 로 저장한다."""

from collections import deque
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
SHEET = HERE / "art" / "sheet.png"

# 칸 선 위치 (sheet.png 에서 잰 값)
LINE_X = (700, 707)  # 세로 칸 선
LINE_Y = (380, 387)  # 가로 칸 선

WHITE = 200  # 이보다 밝으면 배경 흰색으로 본다
EDGE = 120   # 지운 곳 옆에서 이보다 밝은 테두리 픽셀은 반쯤 투명하게


def cut_panels(sheet):
    w, h = sheet.size
    left = (0, LINE_X[0])
    right = (LINE_X[1] + 1, w)
    top = (0, LINE_Y[0])
    bottom = (LINE_Y[1] + 1, h)
    # ① 왼쪽 위, ② 오른쪽 위, ③ 왼쪽 아래, ④ 오른쪽 아래
    boxes = [(left, top), (right, top), (left, bottom), (right, bottom)]
    return [sheet.crop((x[0], y[0], x[1], y[1])) for x, y in boxes]


def bright(p):
    return min(p[0], p[1], p[2])


def clear_background(panel):
    """테두리에서부터 이어진 흰색만 지운다. 고양이 몸 안쪽 흰색은 선에 막혀 남는다."""
    img = panel.convert("RGBA")
    px = img.load()
    w, h = img.size
    gone = [[False] * h for _ in range(w)]
    queue = deque()
    for x in range(w):
        queue.extend([(x, 0), (x, h - 1)])
    for y in range(h):
        queue.extend([(0, y), (w - 1, y)])

    while queue:
        x, y = queue.popleft()
        if gone[x][y] or bright(px[x, y]) < WHITE:
            continue
        gone[x][y] = True
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not gone[nx][ny]:
                queue.append((nx, ny))

    # 지운 곳 바로 옆의 밝은 회색 테두리는 밝을수록 투명하게 해서 흰 테두리를 없앤다
    for x in range(w):
        for y in range(h):
            if gone[x][y]:
                continue
            r, g, b, a = px[x, y]
            v = bright(px[x, y])
            if v <= EDGE:
                continue
            near = any(
                0 <= nx < w and 0 <= ny < h and gone[nx][ny]
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
            )
            if near:
                alpha = int(255 * (255 - v) / (255 - EDGE))
                px[x, y] = (0, 0, 0, alpha)
    return img


def find_desk_line(img):
    """그림 양 끝까지 뻗은 가로 책상 선의 위·아래 줄을 찾는다."""
    px = img.load()
    w, h = img.size
    rows = [
        y for y in range(h // 3, h * 3 // 4)
        if sum(px[x, y][3] > 0 for x in range(w)) > w * 0.6
    ]
    # 처음 이어진 줄 묶음이 책상 선이다
    band = [rows[0]]
    for y in rows[1:]:
        if y != band[-1] + 1:
            break
        band.append(y)
    return band[0], band[-1]


def remove_desk_line(img):
    """책상 선 중 바로 위에 고양이가 없는 곳만 지운다. 고양이 몸 아랫선은 남긴다."""
    px = img.load()
    w, h = img.size
    top, bottom = find_desk_line(img)
    for x in range(w):
        if px[x, top - 4][3] > 0:
            continue
        # 선은 칸마다 높이가 조금 달라서, 이 세로줄에서 처음 나오는 선 한 줄기를 찾는다
        y = top - 3
        while y < bottom + 12 and px[x, y][3] == 0:
            y += 1
        start = y
        while y < h and px[x, y][3] > 0:
            y += 1
        # 선 굵기(8줄쯤)보다 길면 키보드에 붙은 것이라 그대로 둔다
        if y - start <= 12:
            for yy in range(start, y):
                px[x, yy] = (255, 255, 255, 0)
    return img


def remove_specks(img, size=300):
    """선을 지우고 남은 작은 조각(반짝이 표시 등)을 지운다."""
    px = img.load()
    w, h = img.size
    seen = [[False] * h for _ in range(w)]
    for sx in range(w):
        for sy in range(h):
            if seen[sx][sy] or px[sx, sy][3] == 0:
                continue
            group = []
            queue = deque([(sx, sy)])
            seen[sx][sy] = True
            while queue:
                x, y = queue.popleft()
                group.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny] and px[nx, ny][3] > 0:
                        seen[nx][ny] = True
                        queue.append((nx, ny))
            if len(group) < size:
                for x, y in group:
                    px[x, y] = (255, 255, 255, 0)
    return img


def main():
    sheet = Image.open(SHEET)
    frames = [clear_background(p) for p in cut_panels(sheet)]
    frames = [remove_specks(remove_desk_line(f)) for f in frames]

    # 네 그림을 같은 크기로: 네 그림에서 보이는 부분을 모두 담는 상자로 똑같이 자른다
    boxes = [f.getbbox() for f in frames]
    box = (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )
    for i, f in enumerate(frames, start=1):
        out = HERE / "art" / f"frame{i}.png"
        f.crop(box).save(out)
        print(out.name, f.crop(box).size, "보이는 부분", boxes[i - 1])


if __name__ == "__main__":
    main()
