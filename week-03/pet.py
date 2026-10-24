"""화면 오른쪽 아래에 타자 치는 고양이 펫을 띄운다."""

import sys
from pathlib import Path

from pynput import keyboard
from PySide6.QtCore import QObject, QRect, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QIcon, QPixmap
from PySide6.QtWidgets import QApplication, QLabel, QMenu, QSystemTrayIcon

HERE = Path(__file__).parent
ART = HERE / "art"

WIDTH = 200       # 펫 가로 크기(픽셀)
PAW_UP_MS = 150   # 키를 누른 뒤 손을 다시 드는 데 걸리는 시간
SLEEP_MS = 5000   # 이만큼 안 누르면 졸기

# 그림 번호 (frame1~4.png 순서)
IDLE, PAW_A, PAW_B, SLEEP = 0, 1, 2, 3


class KeyCounter(QObject):
    """키를 눌렀다는 사실만 알린다. 어떤 키인지는 받자마자 버리고 어디에도 남기지 않는다."""

    pressed = Signal()

    def __init__(self):
        super().__init__()
        # pynput 은 다른 스레드에서 부르므로 Signal 로 화면 쪽에 넘긴다
        self.listener = keyboard.Listener(on_press=lambda _key: self.pressed.emit())
        self.listener.daemon = True

    def start(self):
        self.listener.start()

    def stop(self):
        self.listener.stop()


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
        self.show_frame(IDLE)

        self.next_paw = PAW_A
        self.paw_up_timer = QTimer(self, singleShot=True, interval=PAW_UP_MS)
        self.paw_up_timer.timeout.connect(self.paw_up)
        self.sleep_timer = QTimer(self, singleShot=True, interval=SLEEP_MS)
        self.sleep_timer.timeout.connect(lambda: self.show_frame(SLEEP))
        self.sleep_timer.start()

    def show_frame(self, index):
        self.current = index
        self.setPixmap(self.frames[index])
        self.adjustSize()

    def on_key(self):
        """키를 누를 때마다 ② ③ 을 번갈아 보여 주고, 졸던 중이면 깨어난다."""
        self.show_frame(self.next_paw)
        self.next_paw = PAW_B if self.next_paw == PAW_A else PAW_A
        self.paw_up_timer.start()
        self.sleep_timer.start()

    def paw_up(self):
        if self.current in (PAW_A, PAW_B):
            self.show_frame(IDLE)

    def move_to_corner(self):
        """오른쪽 아래, 작업 표시줄 바로 위에 둔다."""
        area = self.screen().availableGeometry()
        self.move(area.right() - self.width() + 1, area.bottom() - self.height() + 1)


def make_tray(app):
    """시계 옆 트레이 아이콘. 오른쪽 클릭 메뉴에 "끄기"가 있다."""
    # ① 그림에서 고양이 얼굴 쪽을 정사각형으로 잘라 아이콘으로 쓴다
    face = QPixmap(str(ART / "frame1.png")).copy(QRect(180, 0, 335, 335))
    tray = QSystemTrayIcon(QIcon(face), app)

    menu = QMenu()
    quit_action = QAction("끄기", menu)
    quit_action.triggered.connect(app.quit)
    menu.addAction(quit_action)

    tray.setContextMenu(menu)
    tray.setToolTip("0번")
    tray.show()
    return tray, menu


def main():
    app = QApplication(sys.argv)
    dpr = app.primaryScreen().devicePixelRatio()
    pet = Pet(load_frames(dpr))
    pet.move_to_corner()
    pet.show()
    tray, menu = make_tray(app)

    # 누른 횟수는 이 숫자 하나만 기억한다. 파일에 저장하지 않아서 끄면 사라진다.
    count = {"n": 0}

    def on_key():
        count["n"] += 1
        tray.setToolTip(f"{count['n']}번")
        pet.on_key()

    keys = KeyCounter()
    # pynput 스레드에서 온 알림을 화면 스레드에서 처리하도록 줄 세운다
    keys.pressed.connect(on_key, Qt.QueuedConnection)
    keys.start()
    app.aboutToQuit.connect(keys.stop)

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
