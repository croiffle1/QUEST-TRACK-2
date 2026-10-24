"""화면 오른쪽 아래에 타자 치는 고양이 펫을 띄운다."""

import sys
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QApplication, QLabel

HERE = Path(__file__).parent
ART = HERE / "art"

WIDTH = 200  # 펫 가로 크기(픽셀)


def load_frames(dpr):
    """frame1~4.png 를 가로 200픽셀로 줄여서 불러온다. 고해상도 화면에서도 선명하게."""
    frames = []
    for i in range(1, 5):
        pix = QPixmap(str(ART / f"frame{i}.png"))
        pix = pix.scaledToWidth(round(WIDTH * dpr), Qt.SmoothTransformation)
        pix.setDevicePixelRatio(dpr)
        frames.append(pix)
    return frames


class Pet(QLabel):
    def __init__(self, frames):
        super().__init__()
        self.frames = frames
        # 테두리 없음, 언제나 맨 위, 작업 표시줄에 안 나옴, 마우스는 통과
        self.setWindowFlags(
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.Tool
            | Qt.WindowTransparentForInput
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.show_frame(0)

    def show_frame(self, index):
        self.setPixmap(self.frames[index])
        self.adjustSize()

    def move_to_corner(self):
        """오른쪽 아래, 작업 표시줄 바로 위에 둔다."""
        area = self.screen().availableGeometry()
        self.move(area.right() - self.width() + 1, area.bottom() - self.height() + 1)


def main():
    app = QApplication(sys.argv)
    dpr = app.primaryScreen().devicePixelRatio()
    pet = Pet(load_frames(dpr))
    pet.move_to_corner()
    pet.show()

    # 확인용: python pet.py --돌려보기 로 켜면 ①~④ 를 0.5초마다 돌려 보여 준다
    if "--돌려보기" in sys.argv:
        state = {"i": 0}

        def next_frame():
            state["i"] = (state["i"] + 1) % 4
            pet.show_frame(state["i"])

        timer = QTimer()
        timer.timeout.connect(next_frame)
        timer.start(500)

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
