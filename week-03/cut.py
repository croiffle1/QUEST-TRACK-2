"""art/sheet.png 를 네 칸으로 자르고 바깥 흰 배경을 투명하게 해서 art/frame1~4.png 로 저장한다."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).parent
SHEET = HERE / "art" / "sheet.png"

# 칸 선 위치 (sheet.png 에서 잰 값)
LINE_X = (700, 707)  # 세로 칸 선
LINE_Y = (380, 387)  # 가로 칸 선

WHITE = 200  # 이보다 밝으면 배경 흰색으로 본다
EDGE = 120   # 지운 곳 옆에서 이보다 밝은 테두리 픽셀은 반쯤 투명하게
DARK = 55    # 이보다 어두우면 검은 선
GRAY = (60, 110)  # 키보드 회색 밝기
OUTLINE = 9  # 고양이 흰 부분에서 이만큼 안의 검은 선은 고양이 테두리로 본다
PAD = 20     # 고양이를 옮길 때 잘리지 않게 둘레에 두는 여백


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


def white_groups(img, size=500):
    """흰색 덩어리(고양이 몸, 팔, 발) 자리를 표시한 마스크. 키보드에는 흰색이 없다."""
    px = img.load()
    w, h = img.size
    mask = Image.new("L", img.size, 0)
    mpx = mask.load()
    seen = [[False] * h for _ in range(w)]
    for sx in range(w):
        for sy in range(h):
            p = px[sx, sy]
            if seen[sx][sy] or p[3] < 255 or bright(p) < WHITE:
                continue
            group = []
            queue = deque([(sx, sy)])
            seen[sx][sy] = True
            while queue:
                x, y = queue.popleft()
                group.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[nx][ny]:
                        q = px[nx, ny]
                        if q[3] == 255 and bright(q) >= WHITE:
                            seen[nx][ny] = True
                            queue.append((nx, ny))
            if len(group) >= size:
                for x, y in group:
                    mpx[x, y] = 255
    return mask


def split_cat(img):
    """그림을 고양이와 키보드로 나눈다. 고양이 = 흰 덩어리 + 그 둘레의 검은 테두리."""
    px = img.load()
    w, h = img.size
    white = white_groups(img)
    near = white.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 1)).load()
    wpx = white.load()
    # 진한 검은 선 바로 옆의 흐린 픽셀만 테두리로 본다. 떨어져 있는 흐린 선(원래 그림에 남은 팔 자국)은 버린다
    solid = Image.new("L", img.size, 0)
    spx = solid.load()
    for x in range(w):
        for y in range(h):
            p = px[x, y]
            if p[3] == 255 and max(p[:3]) < DARK:
                spx[x, y] = 255
    by_line = solid.filter(ImageFilter.MaxFilter(5)).load()
    cat = Image.new("RGBA", img.size, (0, 0, 0, 0))
    keys = Image.new("RGBA", img.size, (0, 0, 0, 0))
    cpx, kpx = cat.load(), keys.load()
    for x in range(w):
        for y in range(h):
            p = px[x, y]
            if p[3] == 0:
                continue
            # 흰 부분이거나, 흰 부분 가까이의 검은 선/흐린 테두리면 고양이
            dark = max(p[:3]) < DARK and p[3] == 255
            soft = p[3] < 255 and by_line[x, y]
            if wpx[x, y] or (near[x, y] and (dark or soft)):
                cpx[x, y] = p
            else:
                kpx[x, y] = p
    return cat, keys


def keyboard_anchor(keys):
    """키보드 위치 기준점: 회색 키보드 윗면이 시작하는 줄과 가로 가운데."""
    px = keys.load()
    w, h = keys.size
    gray = [
        (x, y) for x in range(w) for y in range(h)
        if px[x, y][3] == 255 and GRAY[0] <= bright(px[x, y]) <= GRAY[1]
    ]
    rows = {}
    for x, y in gray:
        rows[y] = rows.get(y, 0) + 1
    top = min(y for y, n in rows.items() if n > 100)
    xs = [x for x, _ in gray]
    return (min(xs) + max(xs)) / 2, top


def unify_keyboard(frames, bottoms):
    """네 그림 모두 ① 의 키보드를 쓰고, 고양이는 ① 과 같은 크기·자리로 맞춘다."""
    parts = [split_cat(f) for f in frames]
    base_keys = parts[0][1]
    base_x, base_y = keyboard_anchor(base_keys)
    # ① 의 키보드 윗선보다 위(팔 둘레의 흐린 회색 등)는 키보드가 아니니 버린다
    kpx = base_keys.load()
    for x in range(base_keys.width):
        for y in range(int(base_y) - 8):
            kpx[x, y] = (0, 0, 0, 0)
    # 고양이 크기 맞추기: 귀 끝부터 몸 아래(책상 선)까지 높이를 ① 에 맞추고,
    # 몸 아래는 ① 과 같은 높이에, 입은 ① 과 같은 가로 자리에 둔다
    base_top, base_bottom = parts[0][0].getbbox()[1], bottoms[0]
    base_mouth = mouth_x(parts[0][0])
    out = []
    for (cat, _keys), bottom in zip(parts, bottoms):
        top = cat.getbbox()[1]
        scale = (base_bottom - base_top) / (bottom - top)
        mouth = mouth_x(cat)
        if scale != 1:
            cat = cat.resize((round(cat.width * scale), round(cat.height * scale)), Image.LANCZOS)
        dx = round(base_mouth - mouth * scale)
        dy = round(base_bottom - bottom * scale)
        canvas = Image.new("RGBA", (base_keys.width + 2 * PAD, base_keys.height + 2 * PAD), (0, 0, 0, 0))
        canvas.alpha_composite(base_keys, (PAD, PAD))
        canvas.alpha_composite(cat, (PAD + dx, PAD + dy))
        print(f"  고양이 크기 {scale:.3f}배, 옮김 {(dx, dy)}")
        out.append(canvas)
    return out


def mouth_x(cat):
    """입(ω) 가운데의 가로 위치. 얼굴 안에서 가로 40~70픽셀짜리 검은 덩어리를 찾는다.
    눈을 감은 ④ 는 눈도 이만큼 넓어서, 찾은 것 중 가운데 것을 입으로 본다."""
    px = cat.load()
    w, h = cat.size
    seen = set()
    found = []
    for sx in range(w):
        for sy in range(h):
            p = px[sx, sy]
            if (sx, sy) in seen or p[3] < 200 or max(p[:3]) > 80:
                continue
            group = []
            queue = deque([(sx, sy)])
            seen.add((sx, sy))
            while queue:
                x, y = queue.popleft()
                group.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen:
                        q = px[nx, ny]
                        if q[3] >= 200 and max(q[:3]) <= 80:
                            seen.add((nx, ny))
                            queue.append((nx, ny))
            xs = [x for x, _ in group]
            ys = [y for _, y in group]
            if 40 <= max(xs) - min(xs) <= 70 and max(ys) - min(ys) < 40 and len(group) < 1500:
                found.append((min(xs) + max(xs)) / 2)
    if not found:
        raise ValueError("입을 찾지 못했어요")
    found.sort()
    return found[len(found) // 2]


def main():
    sheet = Image.open(SHEET)
    frames = [clear_background(p) for p in cut_panels(sheet)]
    # 몸 아래 = 책상 선 윗줄. 선을 지우기 전에 재 둔다
    bottoms = [find_desk_line(f)[0] for f in frames]
    frames = [remove_specks(remove_desk_line(f)) for f in frames]
    frames = unify_keyboard(frames, bottoms)

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
